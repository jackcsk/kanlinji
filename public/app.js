import { DEFAULTS, MODES, GRIDS, MAX_TEXT, normalizeOptions, buildWorksheet, charactersForStrokes, usesStrokeData, gridMarkup, renderPage } from './worksheet.js';

const $ = selector => document.querySelector(selector);
const form = $('#worksheet-form');
const modeHelp = {
  full: '每個字一整行：先看範字，再沿著淡字描寫。',
  half: '每個字練習半行，一行放兩個字。',
  'full-blank': '描紅一整行，再空一行自己寫。',
  stroke: '完整範字後，逐筆累加顯示書寫順序。',
  'stroke-trace': '逐筆示範後，增加一整行描紅。',
  'stroke-blank': '逐筆示範後，空一行自己寫。',
  'stroke-trace-blank': '依序練習筆順、整行描紅與空白書寫。',
  words: '詞語以 |、逗號或空格分隔；每個詞語重複一行。',
  'words-blank': '每個詞語重複一行，接著空一行自己寫。',
  sentences: '句子以 | 分隔；每句會在自己的頁面重複。',
  article: '依文章順序寫出，保留標點；換行可分段。',
  'article-blank': '文章按順序排入，每行之間留一行練習。',
  'official-tw': '台灣教育部全筆順原圖，旁附兩欄練習格。保留原圖色彩與留白，建議直向列印；可離線使用。',
};
$('#mode').replaceChildren(...Object.entries(MODES).map(([value, label]) => {
  const option = new Option(value === 'official-tw' ? `${label}（需另行安裝）` : label, value);
  if (value === 'official-tw') option.disabled = true;
  return option;
}));
const officialExample = document.querySelector('[data-example="official"]');
officialExample.disabled = true;
officialExample.title = '台灣教育部原圖需另行安裝，詳見 README。';
$('#grid-options').innerHTML = Object.entries(GRIDS).map(([value, name]) => `<label class="grid-choice"><input type="radio" name="grid" value="${value}" ${value === DEFAULTS.grid ? 'checked' : ''}><svg viewBox="0 0 100 100" aria-hidden="true">${gridMarkup(value)}</svg><span>${name}</span></label>`).join('');

const printStyle = document.createElement('style');
document.head.append(printStyle);
const cache = new Map();
let current = null;
let pageIndex = 0;
let revision = 0;
let debounce;
let lastKey = '';
let metadata = null;
let activeRequest;

function readOptions() {
  const fields = Object.fromEntries(new FormData(form));
  for (const key of ['fillLast','strokeFill','fallbackCn','reverse']) fields[key] = form.elements[key].checked;
  return normalizeOptions(fields);
}

function updateFields() {
  const mode = form.elements.mode.value;
  const official = mode === 'official-tw';
  $('#mode-help').textContent = modeHelp[mode];
  $('#character-count').textContent = `${Array.from(form.elements.text.value).length} / ${MAX_TEXT}`;
  $('#size-output').textContent = `${form.elements.cellSize.value} mm`;
  $('#custom-font-field').hidden = official || form.elements.font.value !== 'custom';
  $('#stroke-settings').hidden = official || (!mode.startsWith('stroke') && form.elements.font.value !== 'kai');
  $('#stroke-fill-option').hidden = !mode.startsWith('stroke');
  $('#fallback-option').hidden = form.elements.standard.value !== 'tw';
  form.elements.font.disabled = official;
  for (const key of ['trace', 'textColor', 'fillLast']) form.elements[key].disabled = official;
  $('#official-source').hidden = !official;
  const font = form.elements.font.value;
  const inputFonts = {
    kai: 'inherit',
    pang: '龐中華楷體,庞中华楷体,WorksheetKai,serif',
    tian: '田英章楷書,田英章楷书,WorksheetKai,serif',
    sans: 'system-ui,sans-serif',
  };
  form.elements.text.style.fontFamily = font === 'custom' ? `${form.elements.customFont.value || 'WorksheetKai'},WorksheetKai,serif` : inputFonts[font];
  let strokeFontHelp = '範字與描紅使用所選字體；逐筆示範使用所選筆順字庫。';
  if (font === 'kai') strokeFontHelp = '輸入欄沿用網站字體；字帖範字、描紅與逐筆示範使用所選筆順字庫，缺字用內建文楷。';
  if (font === 'kai' && form.elements.standard.value === 'tw' && form.elements.fallbackCn.checked) strokeFontHelp = '輸入欄沿用網站字體；字帖中 AnimCJK 字用原字形，後備字全程用中國大陸筆順字形。';
  $('#stroke-font-help').textContent = strokeFontHelp;
  const infoType = form.elements.infoType.value;
  $('#info-text-field').hidden = !['fields','custom'].includes(infoType);
  $('#info-label').textContent = infoType === 'fields' ? '欄位名稱（以頓號或逗號分隔）' : '自訂文案';
  if (metadata) {
    const standard = metadata.standards[form.elements.standard.value];
    const fallbackHint = form.elements.standard.value === 'tw' && form.elements.fallbackCn.checked ? '缺字會以中國大陸 Hanzi Writer Data 補字形及筆順，並標明來源。' : '缺字只顯示範字，不會套用其他地區筆順。';
    $('#data-coverage').textContent = standard ? `${standard.label}：${standard.count.toLocaleString()} 字。${fallbackHint}` : '未安裝此地區字庫。';
  }
  updateReferences();
}

function setStatus(message, warning = '') {
  $('#status').textContent = message;
  $('#warning').hidden = !warning;
  $('#warning').textContent = warning;
}

function showPage() {
  if (!current) return;
  pageIndex = Math.max(0, Math.min(pageIndex, current.pages.length - 1));
  document.querySelectorAll('.sheet').forEach((sheet, i) => sheet.classList.toggle('active', i === pageIndex));
  $('#page-counter').textContent = `第 ${pageIndex + 1} / ${current.pages.length} 頁`;
  $('#previous').disabled = pageIndex === 0;
  $('#next').disabled = pageIndex >= current.pages.length - 1;
}

async function generate({ forPrint = false } = {}) {
  clearTimeout(debounce);
  updateFields();
  const token = ++revision;
  activeRequest?.abort();
  activeRequest = new AbortController();
  $('#print').disabled = true;
  $('#generate').disabled = true;
  let options;
  try {
    options = readOptions();
    const official = options.mode === 'official-tw';
    const needsStrokes = usesStrokeData(options);
    const useFallback = needsStrokes && options.standard === 'tw' && options.fallbackCn;
    const provider = official ? 'official-tw' : useFallback ? 'tw+cn' : options.standard;
    const needed = official || needsStrokes ? charactersForStrokes(options.text) : [];
    const unloaded = needed.filter(c => !cache.has(`${provider}:${c}`));
    let loadWarning = '';
    if (unloaded.length) {
      setStatus(official ? '正在準備教育部原版筆順圖…' : '正在準備本地字形與筆順…');
      try {
        const response = await fetch(official ? '/api/official-tw' : '/api/strokes', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ characters: unloaded.join(''), standard: options.standard, fallbackCn: useFallback }), signal: activeRequest.signal,
        });
        if (!response.ok) throw new Error('字庫載入失敗');
        const { characters } = await response.json();
        for (const c of unloaded) cache.set(`${provider}:${c}`, characters[c] || null);
      } catch (error) {
        if (error.name === 'AbortError') return false;
        if (official || options.mode.startsWith('stroke')) throw new Error('筆順字庫載入失敗，請確認伺服器連線後重試。');
        loadWarning = '字庫暫時無法載入，本次使用內建文楷字體。';
      }
    }
    if (token !== revision) return false;
    const strokes = Object.fromEntries(needed.map(c => [c, cache.get(`${provider}:${c}`)]));
    if (official) {
      // Decode the same original PNGs before allowing print, including hidden pages.
      await Promise.all(Object.values(strokes).filter(Boolean).map(asset => {
        const img = new Image();
        img.src = `data:image/png;base64,${asset.png}`;
        return img.decode();
      }));
      if (token !== revision) return false;
    }
    const worksheet = buildWorksheet(options, strokes);
    if (options.reverse && !official) worksheet.pages.forEach(page => page.forEach(row => row.reverse()));
    const missing = worksheet.missing.length ? official ? `台灣教育部字庫未收錄：${worksheet.missing.join('、')}。已保留練習格，不替換異體字或其他地區筆順。` : `以下字沒有可用的「${metadata?.standards[options.standard]?.label || options.standard}」字形／筆順資料，僅以字體顯示範字：${worksheet.missing.join('、')}。` : '';
    const fallbackWarning = worksheet.fallback?.length ? `後備字形／筆順：${worksheet.fallback.join('、')} 使用中國大陸 Hanzi Writer Data；字形及筆順可能與台灣不同。` : '';
    const warning = [loadWarning, fallbackWarning, missing].filter(Boolean).join(' ');
    const key = JSON.stringify(options);
    if (key !== lastKey) pageIndex = 0;
    lastKey = key;
    $('#pages').innerHTML = worksheet.pages.map((_, i) => `<div class="sheet${i === pageIndex ? ' active' : ''}">${renderPage(worksheet, i, strokes)}</div>`).join('');
    const { width, height, columns, rows } = worksheet.geometry;
    printStyle.textContent = `:root{--page-width:${width}mm;--page-height:${height}mm}@page{size:${width}mm ${height}mm;margin:0}`;
    current = worksheet;
    showPage();
    $('#paper-summary').textContent = `${options.paper} · ${options.orientation === 'portrait' ? '直向' : '橫向'}`;
    setStatus(`${official ? '台灣教育部原版筆順＋練習格' : `${columns} 欄 × ${rows} 行`} · 共 ${worksheet.pages.length} 頁${options.text.trim() ? '' : ' · 空白練習紙'}`, warning);
    // Printed output waits for the bundled font; screen preview remains responsive.
    if (forPrint) {
      await document.fonts.load('16px WorksheetKai');
    }
    return token === revision;
  } catch (error) {
    if (token === revision) {
      setStatus('未能產生字帖', error.message);
      current = null;
      $('#pages').replaceChildren();
      $('#page-counter').textContent = '尚無字帖';
      $('#previous').disabled = $('#next').disabled = true;
    }
    return false;
  } finally {
    if (token === revision) {
      $('#generate').disabled = false;
      $('#print').disabled = !current;
    }
  }
}

function schedule() {
  updateFields();
  $('#print').disabled = true;
  clearTimeout(debounce);
  // Invalidate any in-flight response immediately, before the next debounce fires.
  revision++;
  activeRequest?.abort();
  debounce = setTimeout(() => generate(), 250);
}
form.addEventListener('input', schedule);
form.addEventListener('change', schedule);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (await generate()) $('.preview-area').scrollIntoView({behavior:'smooth',block:'start'});
});
$('#clear').addEventListener('click', () => { form.elements.text.value = ''; form.elements.text.focus(); generate(); });
$('#reset-settings').addEventListener('click', () => { form.reset(); form.elements.font.disabled = false; generate(); });
$('#previous').addEventListener('click', () => { pageIndex--; showPage(); $('.paper-desk').scrollTop = 0; });
$('#next').addEventListener('click', () => { pageIndex++; showPage(); $('.paper-desk').scrollTop = 0; });
$('#print').addEventListener('click', async () => {
  if (await generate({forPrint:true})) window.print();
});

const examples = {
  animcjk: { text: '永我學', mode: 'stroke-trace', standard: 'tw' },
  chars: { text: '天地玄黃宇宙洪荒', mode: 'full' },
  poem: { text: '床前明月光，疑是地上霜。\n舉頭望明月，低頭思故鄉。', mode: 'article-blank' },
  words: { text: '春天 | 花草 | 山川 | 明月', mode: 'words-blank' },
  official: { text: '永我學', mode: 'official-tw' },
};
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  const example = examples[button.dataset.example];
  form.elements.text.value = example.text;
  form.elements.mode.value = example.mode;
  if (example.standard) form.elements.standard.value = example.standard;
  generate();
}));
const palettes = {green:['#769b87','#303b35'],black:['#7b7b7b','#222222'],red:['#b96760','#973a36'],textbook:['#cb8b87','#3e4548']};
document.querySelectorAll('[data-palette]').forEach(button => button.addEventListener('click', () => {
  [form.elements.gridColor.value, form.elements.textColor.value] = palettes[button.dataset.palette];
  generate();
}));

fetch('/api/meta').then(response => {
  if (!response.ok) throw new Error('metadata unavailable');
  return response.json();
}).then(data => {
  metadata = data;
  const officialAvailable = data.officialTaiwan?.available === true;
  const officialOption = form.elements.mode.querySelector('[value="official-tw"]');
  officialOption.disabled = !officialAvailable;
  officialOption.textContent = officialAvailable ? MODES['official-tw'] : `${MODES['official-tw']}（需另行安裝）`;
  officialExample.disabled = !officialAvailable;
  officialExample.title = officialAvailable ? '' : '台灣教育部原圖需另行安裝，詳見 README。';
  $('#official-availability').hidden = officialAvailable;
  $('#official-count').textContent = officialAvailable ? data.officialTaiwan.count.toLocaleString() : '—';
  if (!officialAvailable && form.elements.mode.value === 'official-tw') form.elements.mode.value = DEFAULTS.mode;
  if (data.standards.hk) {
    const option = form.elements.standard.querySelector('[value="hk"]');
    option.disabled = false;
    option.textContent = '香港';
  }
  updateFields();
}).catch(() => { $('#data-coverage').textContent = '無法讀取字庫資訊，請重新整理頁面。'; });

let referenceKey = '';
function updateReferences() {
  const chars = charactersForStrokes(form.elements.text.value);
  const key = chars.join('');
  if (key === referenceKey) return;
  referenceKey = key;
  const select = $('#reference-character');
  const previous = select.value;
  select.replaceChildren(...chars.map(c => new Option(c, c)));
  if (chars.includes(previous)) select.value = previous;
  $('#official-references').hidden = !chars.length;
  resetReference();
}
function resetReference() {
  $('#hk-character').value = $('#reference-character').value;
  $('#official-viewer').replaceChildren();
  $('#reference-status').textContent = '';
}
$('#reference-character').addEventListener('change', resetReference);
$('#load-tw-viewer').addEventListener('click', () => {
  const char = $('#reference-character').value;
  if (!char) return;
  const source = 'https://stroke-order.learningweb.moe.edu.tw/';
  const id = char.codePointAt(0);
  const frame = document.createElement('iframe');
  frame.src = `${source}dictFrame.jsp?ID=${id}`;
  frame.title = `${char}：台灣教育部官方筆順動畫`;
  frame.width = '320'; frame.height = '520'; frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer';
  const link = document.createElement('a');
  link.href = `${source}dictView.jsp?ID=${id}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = '另開台灣教育部原頁 ↗';
  $('#official-viewer').replaceChildren(frame, link);
  $('#reference-status').textContent = '來源：中華民國教育部《國字標準字體筆順學習網》。動畫需連線；若無法顯示可另開原頁。';
});
generate();
