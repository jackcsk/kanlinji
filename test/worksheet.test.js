import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { DEFAULTS, MODES, GRIDS, buildWorksheet, renderPage, getGeometry, normalizeOptions, charactersForStrokes } from '../public/worksheet.js';

const strokeData = { 永: { paths: Array.from({length:5}, () => 'M 0 0 L 100 100 Z') }, 龘: { paths: Array.from({length:48}, () => 'M 0 0 L 100 100 Z') } };
const filled = sheet => sheet.pages.flat(2).filter(c => c.char);
const options = input => ({ ...DEFAULTS, fillLast:false, ...input });

test('full rows contain one dark exemplar and tracing copies, ignoring punctuation', () => {
  const sheet = buildWorksheet(options({text:'你，好\n天'}));
  assert.equal(sheet.pages[0].length,3);
  assert.equal(sheet.geometry.columns,12);
  assert.equal(filled(sheet).length,36);
  assert.deepEqual(sheet.pages[0].map(row => row[0].char),['你','好','天']);
  for (const row of sheet.pages[0]) {
    assert.equal(row[0].kind,'model');
    assert.ok(row.slice(1).every(c => c.kind === 'trace'));
  }
});

test('full rows use the same character paths and fallback sources as stroke mode', async () => {
  const tw = JSON.parse(gunzipSync(await readFile(new URL('../data/tw.json.gz',import.meta.url))));
  const cn = JSON.parse(gunzipSync(await readFile(new URL('../data/cn.json.gz',import.meta.url))));
  const text = '天地玄黃宇宙洪荒';
  const strokes = Object.fromEntries([...text].map(char => [char,tw[char] || {...cn[char],isFallback:true}]));
  const sheet = buildWorksheet(options({text,mode:'full'}),strokes);
  const fullSvg = renderPage(sheet,0,strokes);
  const strokeSheet = buildWorksheet(options({text,mode:'stroke'}),strokes);
  const strokeSvg = strokeSheet.pages.map((_,i) => renderPage(strokeSheet,i,strokes)).join('');
  assert.deepEqual(sheet.missing,[]);
  assert.deepEqual(sheet.fallback,['玄','宇','宙','洪','荒']);
  for (const char of text) {
    assert.ok(fullSvg.includes(strokes[char].paths[0]),char);
    assert.ok(strokeSvg.includes(strokes[char].paths[0]),char);
    assert.ok(!fullSvg.includes(`font-family="WorksheetKai,serif">${char}</text>`),char);
  }
  assert.ok(fullSvg.includes('後備字形／筆順（玄、宇、宙、洪、荒）：Hanzi Writer Data'));
  const missing = buildWorksheet(options({text:'𠮷',mode:'full'}),strokes);
  assert.deepEqual(missing.missing,['𠮷']);
  const sans = renderPage(buildWorksheet(options({text:'天玄',mode:'full',font:'sans'}),strokes),0,strokes);
  assert.ok(sans.includes('font-family="system-ui,sans-serif,serif">天</text>'));
});

test('half rows place two characters side by side without dropping an odd last character', () => {
  const sheet = buildWorksheet(options({text:'你好天',mode:'half'}));
  assert.equal(sheet.pages[0].length,2);
  assert.deepEqual(sheet.pages[0][0].map(c => c.char), [...'你你你你你你好好好好好好']);
  assert.equal(filled(sheet).filter(c => c.char === '天').length,6);
});

test('word mode repeats complete phrases only and preserves words longer than a row', () => {
  const sheet = buildWorksheet(options({text:'春風吹又生 | 天地玄黃宇宙洪荒日月盈昃辰宿',mode:'words'}));
  assert.equal(sheet.pages[0][0].filter(c => c.char).map(c => c.char).join(''),'春風吹又生春風吹又生');
  assert.equal(sheet.pages[0].slice(1).flat().filter(c => c.char).map(c => c.char).join(''),'天地玄黃宇宙洪荒日月盈昃辰宿');
});

test('sentences each start a separate page and long sentences are never truncated', () => {
  const sheet = buildWorksheet(options({text:'你好。|再見。',mode:'sentences'}));
  assert.equal(sheet.pages.length,2);
  assert.equal(sheet.pages[0][0][0].char,'你');
  assert.equal(sheet.pages[1][0][0].char,'再');
  const long = '天'.repeat(180) + '地';
  const large = buildWorksheet(options({text:long,mode:'sentences'}));
  assert.equal(large.pages.length,2);
  assert.equal(filled(large)[180].char,'地');
});

test('article preserves punctuation, non-BMP characters and paragraph boundaries', () => {
  const text = '天地，𠮷。\n宇宙！';
  const sheet = buildWorksheet(options({text,mode:'article'}));
  assert.equal(filled(sheet).map(c => c.char).join(''),text.replace('\n',''));
  assert.equal(sheet.pages[0][1][0].char,'宇');
});

test('article blank mode inserts practice rows between lines only', () => {
  const sheet = buildWorksheet(options({text:'天地\n玄黃',mode:'article-blank'}));
  assert.equal(sheet.pages[0].length,3);
  assert.ok(sheet.pages[0][1].every(c => c.kind === 'blank'));
});

test('tail filling adds blank rows, not extra content or an extra page', () => {
  const sheet = buildWorksheet({text:'天',fillLast:true});
  assert.equal(sheet.pages[0].length,sheet.geometry.rows);
  assert.ok(sheet.pages[0].slice(1).flat().every(c => c.kind === 'blank'));
  const exact = buildWorksheet({text:'天'.repeat(sheet.geometry.rows)});
  assert.equal(exact.pages.length,1);
});

test('blank input creates a complete blank practice sheet in every mode', () => {
  for (const mode of Object.keys(MODES).filter(mode => mode !== 'official-tw')) {
    const sheet = buildWorksheet(options({text:'',mode}));
    assert.equal(sheet.pages.length,1);
    assert.equal(sheet.pages[0].length,sheet.geometry.rows);
    assert.equal(filled(sheet).length,0);
  }
});

test('stroke mode shows cumulative steps and wraps long sequences', () => {
  const sheet = buildWorksheet(options({text:'永龘',mode:'stroke',strokeFill:false}),strokeData);
  assert.deepEqual(filled(sheet).filter(c => c.char === '永' && c.kind === 'stroke').map(c => c.step),[1,2,3,4,5]);
  assert.equal(filled(sheet).filter(c => c.char === '龘' && c.kind === 'stroke').length,48);
  assert.ok(sheet.pages[0][0].slice(6).every(c => c.kind === 'blank'));
});

test('stroke trace and blank combinations add the correct rows', () => {
  for (const [mode,rows] of [['stroke',1],['stroke-trace',2],['stroke-blank',2],['stroke-trace-blank',3]]) {
    const sheet = buildWorksheet(options({text:'永',mode}),strokeData);
    assert.equal(sheet.pages[0].length,rows);
    if (mode.endsWith('blank')) assert.ok(sheet.pages[0].at(-1).every(c => c.kind === 'blank'));
    if (mode.includes('trace')) assert.ok(sheet.pages[0][1].every(c => c.kind === 'trace'));
  }
});

test('missing data reports affected characters without inventing strokes', () => {
  const sheet = buildWorksheet(options({text:'永𠮷',mode:'stroke'}),strokeData);
  assert.deepEqual(sheet.missing,['𠮷']);
  assert.equal(filled(sheet).filter(c => c.char === '𠮷' && c.kind === 'stroke').length,0);
});

test('AnimCJK keeps covered complete glyphs and font choice changes other complete glyphs', async () => {
  const data = JSON.parse(gunzipSync(await readFile(new URL('../data/tw.json.gz',import.meta.url))));
  const sheet = buildWorksheet(options({text:'為甚麼',mode:'stroke-trace'}),data);
  const svg = renderPage(sheet,0,data);
  assert.deepEqual(sheet.missing,['甚']);
  assert.ok(svg.includes('font-family="WorksheetKai,serif">甚</text>'));
  assert.ok(!svg.includes('font-family="WorksheetKai,serif">為</text>'));
  assert.ok(!svg.includes('font-family="WorksheetKai,serif">麼</text>'));
  assert.ok(svg.includes('translate(0 900) scale(1 -1)'));
  assert.equal(filled(sheet).filter(c => c.char === '甚' && c.kind === 'stroke').length,0);
  const sans = renderPage(buildWorksheet(options({text:'為甚麼',mode:'stroke-trace',font:'sans'}),data),0,data);
  for (const char of '為甚麼') assert.ok(sans.includes(`font-family="system-ui,sans-serif,serif">${char}</text>`));
  assert.ok(sans.includes('translate(0 900) scale(1 -1)'));
});

test('Taiwan worksheet shows fallback strokes and cites the mainland source on print', async () => {
  const tw = JSON.parse(gunzipSync(await readFile(new URL('../data/tw.json.gz',import.meta.url))));
  const cn = JSON.parse(gunzipSync(await readFile(new URL('../data/cn.json.gz',import.meta.url))));
  const strokes = {...tw,'甚':{...cn['甚'],isFallback:true}};
  const sheet = buildWorksheet(options({text:'為甚麼',mode:'stroke-trace'}),strokes);
  const svg = renderPage(sheet,0,strokes);
  assert.deepEqual(sheet.missing,[]);
  assert.deepEqual(sheet.fallback,['甚']);
  assert.equal(filled(sheet).filter(c => c.char === '甚' && c.kind === 'stroke').length,9);
  assert.ok(!svg.includes('font-family="WorksheetKai,serif">甚</text>'));
  assert.equal(svg.split(cn['甚'].paths.at(-1)).length - 1,3);
  assert.ok(!svg.includes('font-family="WorksheetKai,serif">為</text>'));
  assert.ok(svg.includes('† 後備字形／筆順（甚）：Hanzi Writer Data／Make Me a Hanzi（中國大陸）'));
  assert.ok(svg.includes('>†</text>'));
  const sans = renderPage(buildWorksheet(options({text:'甚',mode:'stroke-trace',font:'sans'}),strokes),0,strokes);
  assert.ok(sans.includes('font-family="system-ui,sans-serif,serif">甚</text>'));
  const primaryOnly = renderPage(buildWorksheet(options({text:'為麼',mode:'stroke'}),strokes),0,strokes);
  assert.ok(!primaryOnly.includes('後備筆順'));
});

test('all modes fit every supported paper and orientation at both size extremes', () => {
  for (const paper of ['A4','Letter']) for (const orientation of ['portrait','landscape']) for (const cellSize of [12,15,28]) {
    const g = getGeometry({paper,orientation,cellSize});
    assert.ok(g.left >= 15 && g.left + g.columns * g.size <= g.width - 14.99);
    assert.ok(g.top + (g.rows - 1) * g.rowHeight + g.size < g.height - 10);
    for (const mode of Object.keys(MODES).filter(mode => mode !== 'official-tw')) {
      const sheet = buildWorksheet(options({text:'永龘',paper,orientation,cellSize,mode}),strokeData);
      assert.ok(sheet.pages.every(page => page.length <= g.rows && page.every(row => row.length === g.columns)));
    }
  }
});

test('pagination keeps the complete article across several pages', () => {
  const text = Array.from({length:990}, (_,i) => String.fromCodePoint(0x4e00+i)).join('');
  const sheet = buildWorksheet(options({text,mode:'article',cellSize:28}));
  assert.ok(sheet.pages.length > 10);
  assert.equal(filled(sheet).map(c => c.char).join(''),text);
});

test('oversized input, invalid options and excessive pages produce actionable errors', () => {
  assert.throws(() => buildWorksheet({text:'天'.repeat(1001)}),/1000/);
  assert.throws(() => buildWorksheet({cellSize:0}),/尺寸/);
  assert.throws(() => buildWorksheet({gridColor:'red" onload="x'}),/顏色/);
  assert.throws(() => buildWorksheet({text:'天'.repeat(1000),cellSize:28,mode:'full-blank'}),/100 頁/);
  assert.throws(() => normalizeOptions({mode:'bogus'}),/mode/);
});

test('SVG safely escapes user text, title and custom font names', () => {
  const sheet = buildWorksheet(options({text:'<script>alert(1)</script>',mode:'article',title:'<img src=x>',font:'custom',customFont:'" onload="alert(1)'}));
  const svg = renderPage(sheet,0);
  assert.ok(svg.includes('&lt;img'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('" onload="'));
  for (const grid of Object.keys(GRIDS)) assert.ok(renderPage(buildWorksheet({grid}),0).startsWith('<svg'));
});

test('SVG IDs are unique across printed sheets and stroke steps contain the right paths', () => {
  const sheet = buildWorksheet(options({text:'永'.repeat(17),mode:'stroke'}),strokeData);
  const svgs = sheet.pages.map((_,i) => renderPage(sheet,i,strokeData)).join('');
  const ids = [...svgs.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.ok(svgs.includes('translate(0 900) scale(1 -1)'));
});

test('character request deduplicates Han characters without splitting surrogate pairs', () => {
  assert.deepEqual(charactersForStrokes('永永𠮷 A，1'),['永','𠮷']);
});

test('basic stroke symbols and compatibility ideographs retain their exact code points', () => {
  const sheet = buildWorksheet(options({text:'㇀⺄神',title:'',infoType:'none'}));
  assert.deepEqual(sheet.pages[0].map(row => row[0].char),['㇀','⺄','神']);
  assert.ok(!renderPage(sheet,0).includes('寫字練習'));
});

test('bundled stroke data has usable mainland and Taiwan records', async () => {
  for (const standard of ['cn','tw']) {
    const data = JSON.parse(gunzipSync(await readFile(new URL(`../data/${standard}.json.gz`,import.meta.url))));
    assert.ok(Object.keys(data).length >= 1000);
    assert.ok(data['一'].paths.length === 1);
    assert.ok(data['永'].paths.length === 5);
    assert.ok(data['永'].paths.every(p => typeof p === 'string' && p.startsWith('M')));
  }
});

test('optional Taiwan image mode embeds supplied PNGs and preserves input characters', () => {
  const asset = {png:Buffer.from('synthetic PNG fixture').toString('base64'),width:50,height:725};
  const data = {'永':asset,'裡':asset,'𥑮':asset,'我':asset};
  const sheet = buildWorksheet({mode:'official-tw',text:'永裡裏𥑮永',title:'<原圖>'},data);
  assert.deepEqual(sheet.pages.flat().map(item => item.char),[...'永裡裏𥑮永']);
  assert.deepEqual(sheet.missing,['裏']);
  const svg = sheet.pages.map((_,i) => renderPage(sheet,i,data)).join('');
  assert.ok(svg.includes(`data:image/png;base64,${data['永'].png}`));
  assert.equal((svg.match(/<image /g) || []).length,4);
  assert.ok(svg.includes('CC BY-NC-ND 3.0 TW'));
  assert.ok(svg.includes('中華民國教育部'));
  assert.ok(svg.includes('&lt;原圖&gt;'));
  assert.ok(!svg.includes('clipPath'));
  const reversed = buildWorksheet({mode:'official-tw',text:'永我',reverse:true},data);
  assert.ok(renderPage(reversed,0,data).indexOf('我</text>') < renderPage(reversed,0,data).indexOf('永</text>'));
});

test('official full images and practice grids fit every paper at both size extremes', () => {
  const assets = {'一':{png:'AA==',width:50,height:725},'龍':{png:'AA==',width:95,height:725},'龘':{png:'AA==',width:140,height:725}};
  for (const paper of ['A4','Letter']) for (const orientation of ['portrait','landscape']) for (const cellSize of [12,15,28]) {
    const sheet = buildWorksheet({mode:'official-tw',text:'一龍龘一龍龘',paper,orientation,cellSize},assets);
    const g = sheet.geometry;
    assert.equal(sheet.pages.flat().map(item => item.char).join(''),'一龍龘一龍龘');
    for (const page of sheet.pages) {
      assert.ok(page.reduce((sum,item) => sum + item.width,0) + (page.length - 1) * 8 <= g.width - 30);
      for (const item of page) assert.equal(item.imageWidth, g.imageHeight * assets[item.char].width / assets[item.char].height);
    }
    assert.ok(44 + g.imageHeight < g.height - 22);
    assert.ok(renderPage(sheet,0,assets).includes(`width="${g.width}mm"`));
  }
  assert.throws(() => buildWorksheet({mode:'official-tw',text:'龘'.repeat(1000),cellSize:28},assets),/100 頁/);
  const blank = buildWorksheet({mode:'official-tw',text:''});
  assert.equal(blank.pages.length,1);
  assert.ok(!renderPage(blank,0).includes('<image '));
  assert.ok(renderPage(blank,0).includes('<use href="#moe0grid"'));
});
