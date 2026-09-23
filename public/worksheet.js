export const MODES = {
  full: '多字整行', half: '多字半行', 'full-blank': '多字＋1 空行',
  stroke: '筆順', 'stroke-trace': '筆順＋1 行', 'stroke-blank': '筆順＋1 空行',
  'stroke-trace-blank': '筆順＋1 行＋1 空行', words: '多詞',
  'words-blank': '多詞＋1 空行', sentences: '多句', article: '文章',
  'article-blank': '文章＋1 空行',
  'official-tw': '台灣教育部・原版筆順＋練習格',
};
export const GRIDS = {
  tian: '田字格', mi: '米字格', 'mi-hui': '米字回宮格', hui: '回宮格',
  square: '方格', nine: '九宮格', 'oval-tian': '中蛋田字格', oval: '蛋格',
  center: '中心格', none: '無格',
};
export const DEFAULTS = {
  text: '天地玄黃宇宙洪荒', mode: 'full', grid: 'tian', paper: 'A4',
  orientation: 'portrait', cellSize: 15, font: 'kai', customFont: '',
  gridColor: '#769b87', textColor: '#303b35', trace: 'medium', fillLast: true,
  strokeFill: true, fallbackCn: true, standard: 'tw', title: '每日勤練字',
  infoType: 'fields', infoText: '姓名、日期',
};
export const MAX_TEXT = 1000;
export const MAX_PAGES = 100;
const TONES = { darkest: .8, dark: .65, deep: .5, light: .25, medium: .35, faint: .13, invisible: 0, outline: .5, shadow: .35 };
const STANDARDS = ['cn', 'tw', 'hk'];
const FONTS = {
  kai: 'WorksheetKai', pang: '龐中華楷體,庞中华楷体,WorksheetKai',
  tian: '田英章楷書,田英章楷书,WorksheetKai', sans: 'system-ui,sans-serif', custom: 'WorksheetKai',
};
export const escapeXml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function normalizeOptions(input = {}) {
  const o = { ...DEFAULTS, ...input };
  for (const [key, choices] of Object.entries({ mode: Object.keys(MODES), grid: Object.keys(GRIDS), paper: ['A4','Letter'], orientation: ['portrait','landscape'], font: Object.keys(FONTS), trace: Object.keys(TONES), standard: STANDARDS, infoType: ['fields','motto','custom','none'] })) {
    if (!choices.includes(o[key])) throw new Error(`不支援的設定：${key}`);
  }
  o.text = String(o.text);
  if (Array.from(o.text).length > MAX_TEXT) throw new Error(`一次最多輸入 ${MAX_TEXT} 個字元，請分批產生。`);
  o.cellSize = Number(o.cellSize);
  if (!Number.isFinite(o.cellSize) || o.cellSize < 12 || o.cellSize > 28) throw new Error('格子尺寸須介於 12 至 28 mm。');
  for (const key of ['gridColor', 'textColor']) if (!/^#[\da-f]{6}$/i.test(o[key])) throw new Error('請選擇有效顏色。');
  for (const key of ['title','infoText','customFont']) o[key] = String(o[key]).slice(0, key === 'infoText' ? 80 : 40);
  o.fillLast = o.fillLast === true;
  o.strokeFill = o.strokeFill === true;
  o.fallbackCn = o.fallbackCn === true;
  return o;
}

export function getGeometry(options) {
  let [width, height] = options.paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  if (options.orientation === 'landscape') [width, height] = [height, width];
  const size = options.cellSize;
  const columns = Math.floor((width - 30) / size);
  const rows = Math.floor((height - 50) / (size + 1));
  return { width, height, columns, rows, size, rowHeight: size + 1, left: (width - columns * size) / 2, top: 35 };
}

export function charactersForStrokes(text) {
  return [...new Set(Array.from(text).filter(c => /\p{Script=Han}/u.test(c)))];
}

export function usesStrokeData(options) {
  return options.font === 'kai' || options.mode.startsWith('stroke');
}

// Layout is independent of the DOM so pagination and content preservation are testable.
export function buildWorksheet(input, strokes = {}) {
  const options = normalizeOptions(input);
  const geometry = getGeometry(options);
  if (options.mode === 'official-tw') return buildOfficialWorksheet(options, geometry, strokes);
  const { columns, rows } = geometry;
  const pages = [];
  let page = [];
  const missing = new Set();
  const blankRow = () => Array.from({length: columns}, () => ({ kind: 'blank' }));
  const cell = (char, kind = 'trace', extra = {}) => ({ char, kind, ...extra });
  const finish = () => {
    if (!page.length) return;
    if (options.fillLast) while (page.length < rows) page.push(blankRow());
    pages.push(page);
    page = [];
    if (pages.length > MAX_PAGES) throw new Error(`字帖超過 ${MAX_PAGES} 頁，請減少文字或縮小格子。`);
  };
  const addRow = (row) => {
    if (page.length === rows) finish();
    page.push([...row, ...blankRow()].slice(0, columns));
  };
  const addCells = (cells) => {
    for (let i = 0; i < cells.length; i += columns) addRow(cells.slice(i, i + columns));
  };
  const repeatRow = (char, exemplar = true) => Array.from({length: columns}, (_, i) => cell(char, exemplar && i === 0 ? 'model' : 'trace'));
  const compact = options.text.replace(/\s/gu, '');
  const chars = Array.from(options.text).filter(c => !/[\s\p{P}]/u.test(c));

  if (!compact) {
    page = Array.from({ length: rows }, blankRow);
  } else if (options.mode === 'full' || options.mode === 'full-blank') {
    for (const char of chars) {
      addRow(repeatRow(char));
      if (options.mode === 'full-blank') addRow(blankRow());
    }
  } else if (options.mode === 'half') {
    const half = Math.floor(columns / 2);
    for (let i = 0; i < chars.length; i += 2) {
      const row = [];
      for (const char of chars.slice(i, i + 2)) {
        for (let j = 0; j < half; j++) row.push(cell(char, j === 0 ? 'model' : 'trace'));
      }
      addRow(row);
    }
  } else if (options.mode.startsWith('stroke')) {
    for (const char of chars) {
      const data = strokes[char];
      const cells = [cell(char, 'model')];
      if (data?.paths?.length) {
        for (let i = 1; i <= data.paths.length; i++) cells.push(cell(char, 'stroke', { step: i }));
        while (cells.length % columns) cells.push(options.strokeFill ? cell(char) : { kind: 'blank' });
      } else {
        missing.add(char);
        // A missing stroke record remains an ordinary glyph, never a fabricated sequence.
      }
      addCells(cells);
      if (options.mode.includes('trace')) addRow(repeatRow(char, false));
      if (options.mode.endsWith('blank')) addRow(blankRow());
    }
  } else if (options.mode.startsWith('words')) {
    const words = options.text.split(/[|｜,，、\s]+/u).filter(Boolean);
    for (const word of words) {
      const letters = Array.from(word);
      if (letters.length > columns) {
        addCells(letters.map(c => cell(c)));
      } else {
        const repeats = Math.floor(columns / letters.length);
        addRow(Array.from({ length: repeats }, () => letters.map(c => cell(c))).flat());
      }
      if (options.mode === 'words-blank') addRow(blankRow());
    }
  } else if (options.mode === 'sentences') {
    for (const sentence of compact.split(/[|｜]/u).filter(Boolean)) {
      finish();
      const letters = Array.from(sentence);
      // Long sentences keep all content; shorter ones repeat to fill their own page.
      const length = Math.max(columns * rows, Math.ceil(letters.length / (columns * rows)) * columns * rows);
      addCells(Array.from({length}, (_, i) => cell(letters[i % letters.length])));
      finish();
    }
  } else {
    const paragraphs = options.text.replace(/\r/g, '').split('\n');
    const contentRows = [];
    for (const paragraph of paragraphs) {
      const letters = Array.from(paragraph.replace(/\s/gu, ''));
      if (!letters.length) continue;
      for (let i = 0; i < letters.length; i += columns) contentRows.push(letters.slice(i, i + columns).map(c => cell(c)));
    }
    contentRows.forEach((row, i) => {
      addRow(row);
      if (options.mode === 'article-blank' && i < contentRows.length - 1) addRow(blankRow());
    });
  }
  if (!page.length && !pages.length) page = Array.from({length: rows}, blankRow);
  finish();
  if (options.font === 'kai' && !options.mode.startsWith('stroke')) {
    for (const char of charactersForStrokes(options.text)) if (!strokes[char]?.paths?.length) missing.add(char);
  }
  const fallback = usesStrokeData(options) ? charactersForStrokes(options.text).filter(char => strokes[char]?.isFallback) : [];
  return { options, geometry, pages, missing: [...missing], fallback };
}

export function gridMarkup(type, color = 'currentColor') {
  if (type === 'none') return '';
  const line = (d) => `<path d="${d}"/>`;
  let guides = '';
  if (['tian','mi','mi-hui','oval-tian','oval','center'].includes(type)) guides += line('M50 0V100M0 50H100');
  if (['mi','mi-hui'].includes(type)) guides += line('M0 0L100 100M100 0L0 100');
  if (['hui','mi-hui'].includes(type)) guides += '<rect x="25" y="12.5" width="50" height="75"/>';
  if (type === 'nine') guides += '<rect x="12.5" y="12.5" width="75" height="75"/>' + line('M37.5 12.5V87.5M62.5 12.5V87.5M12.5 37.5H87.5M12.5 62.5H87.5');
  if (['oval','oval-tian'].includes(type)) guides += '<ellipse cx="50" cy="50" rx="32" ry="42"/>';
  if (type === 'center') guides += '<rect x="38" y="38" width="24" height="24" rx="4"/>';
  const border = type === 'oval' ? '<ellipse cx="50" cy="50" rx="49.5" ry="49.5" stroke-width="0.7"/>' : '<rect x="0.5" y="0.5" width="99" height="99" stroke-width="0.7"/>';
  return `<g fill="none" stroke="${escapeXml(color)}">${border}<g stroke-width="0.45" stroke-dasharray="2 2">${guides}</g></g>`;
}

function glyphMarkup(cell, options, data) {
  const c = escapeXml(options.textColor);
  const trace = cell.kind === 'trace' || cell.kind === 'stroke';
  const opacity = trace ? TONES[options.trace] : 1;
  const usePaths = data?.paths?.length && (cell.kind === 'stroke' || options.font === 'kai');
  let shape;
  if (usePaths) {
    const transform = data.transform || 'translate(0 900) scale(1 -1)';
    const paths = cell.kind === 'stroke' ? data.paths.slice(0, cell.step) : data.paths;
    shape = `<g transform="translate(9 7) scale(.08)"><g transform="${escapeXml(transform)}">${paths.map(d => `<path d="${escapeXml(d)}"/>`).join('')}</g></g>`;
  } else {
    const font = options.font === 'custom' ? `${options.customFont || 'WorksheetKai'},WorksheetKai` : FONTS[options.font];
    shape = `<text x="50" y="76" text-anchor="middle" font-size="79" font-family="${escapeXml(font)},serif">${escapeXml(cell.char)}</text>`;
  }
  let result = '';
  if (trace && options.trace === 'shadow') result += `<g fill="${c}" opacity=".18" transform="translate(1.6 1.6)">${shape}</g>`;
  if (trace && options.trace === 'outline') {
    result += `<g fill="white" stroke="${c}" stroke-width="${usePaths ? 8 : .65}" opacity=".6">${shape}</g>`;
  } else {
    result += `<g fill="${c}" opacity="${opacity}">${shape}</g>`;
  }
  if (data?.isFallback && (cell.kind === 'model' || cell.kind === 'stroke')) result += '<text x="88" y="13" fill="#8a6137" font-size="10" font-family="sans-serif">†</text>';
  if (cell.kind === 'stroke') result += `<text x="5" y="94" fill="${c}" font-size="8" font-family="sans-serif">${cell.step}</text>`;
  return result;
}

const MOTTOS = ['一筆一畫，認真寫好每一個字。', '每天練習一點，進步就多一點。', '靜下心來，慢慢寫好。', '把每一次練習，寫成自己的進步。'];

// MOE's complete PNGs are independent works: keep every byte and the full
// aspect ratio, including white space. Practice grids sit beside the originals.
function buildOfficialWorksheet(options, geometry, assets) {
  const imageHeight = Math.min(217.5, geometry.height - 75);
  const available = geometry.width - 30;
  const pages = [];
  let page = [], occupied = 0;
  const missing = new Set();
  const finish = () => {
    if (!page.length) return;
    pages.push(page);
    if (pages.length > MAX_PAGES) throw new Error(`字帖超過 ${MAX_PAGES} 頁，請減少文字或縮小格子。`);
    page = []; occupied = 0;
  };
  for (const char of Array.from(options.text).filter(c => /\p{Script=Han}/u.test(c))) {
    const asset = assets[char];
    if (!asset) missing.add(char);
    const imageWidth = asset ? imageHeight * asset.width / asset.height : 15;
    const width = imageWidth + 4 + geometry.size * 2;
    if (page.length && occupied + 8 + width > available) finish();
    if (page.length) occupied += 8;
    page.push({char, imageWidth, width});
    occupied += width;
  }
  finish();
  if (!pages.length) pages.push([]);
  return {options, geometry:{...geometry, imageHeight}, pages, missing:[...missing]};
}

function pageInfo(o, pageIndex) {
  if (o.infoType === 'fields') return o.infoText.split(/[,，、|｜]/u).map(t => t.trim()).filter(Boolean).map(t => `${t}：________`).join('　　');
  if (o.infoType === 'custom') return o.infoText;
  if (o.infoType === 'motto') return MOTTOS[pageIndex % MOTTOS.length];
  return '';
}

function renderOfficialPage(worksheet, pageIndex, assets) {
  const {options:o, geometry:g, pages} = worksheet;
  const items = o.reverse ? [...pages[pageIndex]].reverse() : pages[pageIndex];
  const prefix = `moe${pageIndex}`;
  const top = 44;
  const practiceRows = Math.floor(g.imageHeight / g.rowHeight);
  const gridAt = (x, y) => `<use href="#${prefix}grid" transform="translate(${x} ${y}) scale(${g.size / 100})"/>`;
  const totalWidth = items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * 8;
  let x = (g.width - totalWidth) / 2;
  let body = '';
  for (const item of items) {
    const asset = assets[item.char];
    body += `<text x="${x}" y="39" font-size="4" font-family="WorksheetKai,serif">${escapeXml(item.char)}</text>`;
    if (asset) body += `<image href="data:image/png;base64,${escapeXml(asset.png)}" x="${x}" y="${top}" width="${item.imageWidth}" height="${g.imageHeight}" preserveAspectRatio="xMinYMin meet"><title>${escapeXml(item.char)}：教育部全筆順提示原圖</title></image>`;
    else body += `<text x="${x}" y="${top + 5}" font-size="2.8">未收錄</text>`;
    const gridX = x + item.imageWidth + 4;
    for (let row = 0; row < practiceRows; row++) for (let col = 0; col < 2; col++) body += gridAt(gridX + col * g.size, top + row * g.rowHeight);
    x += item.width + 8;
  }
  if (!items.length) for (let row = 0; row < practiceRows; row++) for (let col = 0; col < g.columns; col++) body += gridAt(g.left + col * g.size, top + row * g.rowHeight);
  const e = escapeXml;
  const fit = (text, size) => Array.from(text).length * size > g.width - 30 ? ` textLength="${g.width - 30}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="worksheet-page" width="${g.width}mm" height="${g.height}mm" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${e(o.title)}，台灣教育部原版筆順，第 ${pageIndex + 1} 頁，共 ${pages.length} 頁">
  <title>${e(o.title)} — 台灣教育部原版筆順，第 ${pageIndex + 1} 頁</title>
  <defs><g id="${prefix}grid">${gridMarkup(o.grid, o.gridColor)}</g></defs><rect width="100%" height="100%" fill="white"/>
  <g fill="#303b35" font-family="WorksheetKai,serif"><text x="15" y="19" font-size="6"${fit(o.title, 6)}>${e(o.title)}</text><text x="15" y="28" font-size="3.4"${fit(pageInfo(o, pageIndex), 3.4)}>${e(pageInfo(o, pageIndex))}</text></g>
  <g fill="#303b35" font-family="sans-serif">${body}</g>
  <g font-family="sans-serif" font-size="2.5" fill="#666"><text x="15" y="${g.height - 22}">© 中華民國教育部《國字標準字體筆順學習網》・全筆順提示原圖</text>
  <a href="https://stroke-order.learningweb.moe.edu.tw/"><text x="15" y="${g.height - 18}">https://stroke-order.learningweb.moe.edu.tw/</text></a>
  <a href="https://creativecommons.org/licenses/by-nc-nd/3.0/tw/"><text x="15" y="${g.height - 14}">CC BY-NC-ND 3.0 TW · https://creativecommons.org/licenses/by-nc-nd/3.0/tw/</text></a>
  <text x="15" y="${g.height - 10}">原圖按比例顯示・供非商業使用・練習格 ${g.size} mm</text><text x="${g.width - 15}" y="${g.height - 10}" text-anchor="end">${pageIndex + 1} / ${pages.length}</text></g></svg>`;
}

export function renderPage(worksheet, pageIndex, strokes = {}) {
  const { options: o, geometry: g, pages } = worksheet;
  const page = pages[pageIndex];
  if (!page) throw new Error('頁碼不存在。');
  if (o.mode === 'official-tw') return renderOfficialPage(worksheet, pageIndex, strokes);
  const e = escapeXml;
  const title = o.title;
  const info = pageInfo(o, pageIndex);
  const fallback = usesStrokeData(o) ? [...new Set(page.flat().filter(cell => cell.char && strokes[cell.char]?.isFallback).map(cell => cell.char))] : [];
  const fallbackNames = fallback.length > 12 ? `${fallback.slice(0,12).join('、')} 等` : fallback.join('、');
  const fallbackNote = fallback.length ? `<text x="${g.left}" y="${g.height - 16}" font-size="2.6" font-family="sans-serif" fill="#777">† 後備字形／筆順（${e(fallbackNames)}）：Hanzi Writer Data／Make Me a Hanzi（中國大陸）</text>` : '';
  // Per-page identifiers stay unique when every sheet is mounted for printing.
  const prefix = `p${pageIndex}`;
  const glyphs = new Map();
  for (const row of page) for (const c of row) if (c.char) {
    const key = JSON.stringify(c);
    if (!glyphs.has(key)) glyphs.set(key, { id: `${prefix}g${glyphs.size}`, content: glyphMarkup(c, o, strokes[c.char]) });
  }
  const cells = page.map((row, r) => row.map((c, col) => {
    const x = g.left + col * g.size;
    const y = g.top + r * g.rowHeight;
    const glyph = c.char ? `<use href="#${glyphs.get(JSON.stringify(c)).id}"/>` : '';
    return `<g transform="translate(${x} ${y}) scale(${g.size / 100})"><use href="#${prefix}grid"/>${glyph}</g>`;
  }).join('')).join('');
  const fit = (text, width) => Array.from(text).length > width / 3.4 ? ` textLength="${width}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="worksheet-page" width="${g.width}mm" height="${g.height}mm" viewBox="0 0 ${g.width} ${g.height}" role="img" aria-label="${e(title)}，第 ${pageIndex + 1} 頁，共 ${pages.length} 頁">
  <title>${e(title)} — ${e(MODES[o.mode])}，第 ${pageIndex + 1} 頁</title>
  <defs><g id="${prefix}grid">${gridMarkup(o.grid, o.gridColor)}</g>${[...glyphs.values()].map(v => `<g id="${v.id}">${v.content}</g>`).join('')}</defs>
  <rect width="100%" height="100%" fill="white"/>
  <g font-family="WorksheetKai,serif" fill="#303b35"><text x="${g.left}" y="19" font-size="6"${fit(title, g.width - 55)}>${e(title)}</text>
  <text x="${g.left}" y="28" font-size="3.4"${fit(info, g.width - 30)}>${e(info)}</text></g>
  ${cells}${fallbackNote}<g font-family="sans-serif" font-size="2.6" fill="#777"><text x="${g.left}" y="${g.height - 10}">${e(GRIDS[o.grid])} · ${g.size} mm</text><text x="${g.width - g.left}" y="${g.height - 10}" text-anchor="end">${pageIndex + 1} / ${pages.length}</text></g></svg>`;
}
