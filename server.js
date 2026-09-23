import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.otf':'font/otf', '.txt':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8' };
const labels = {cn:'Hanzi Writer（中國大陸）',tw:'AnimCJK 繁體（台灣）',hk:'香港'};
const security = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://stroke-order.learningweb.moe.edu.tw; form-action 'self' https://www.edbchinese.hk; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const moeSource = 'https://stroke-order.learningweb.moe.edu.tw/';
const moeLicense = 'https://creativecommons.org/licenses/by-nc-nd/3.0/tw/';

async function loadDatasets(directory) {
  const datasets = {};
  for (const standard of ['cn','tw','hk']) {
    try {
      const compressed = await readFile(resolve(directory, `${standard}.json.gz`));
      const { _notice, ...characters } = JSON.parse(gunzipSync(compressed));
      datasets[standard] = characters;
    } catch (error) {
      if (error.code === 'ENOENT' && standard === 'hk') continue;
      throw new Error(`無法載入 ${standard} 字庫`, {cause:error});
    }
  }
  return datasets;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_000) {
      const error = new Error('請求資料過大');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('JSON 格式錯誤'); error.status = 400; throw error; }
}

export async function createApp({ dataDirectory = resolve(root,'data') } = {}) {
  const datasets = await loadDatasets(dataDirectory);
  let officialImages = null;
  try {
    officialImages = JSON.parse(gunzipSync(await readFile(resolve(dataDirectory,'moe.json.gz'))));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('無法載入台灣教育部全筆順提示原圖', {cause:error});
  }
  const standards = Object.fromEntries(Object.entries(datasets).map(([id,data]) => [id,{ label:labels[id],count:Object.keys(data).length }]));
  const officialTaiwan = {available:officialImages !== null,count:Object.keys(officialImages || {}).length,label:'台灣教育部全筆順提示（原圖）',licenseUrl:moeLicense,sourceUrl:moeSource};
  return createServer(async (request, response) => {
    const send = (status, data, headers = {}) => {
      response.writeHead(status, { ...security, 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });
      response.end(request.method === 'HEAD' ? undefined : typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/healthz' && ['GET','HEAD'].includes(request.method)) return send(200,{status:'ok'});
      if (url.pathname === '/api/meta' && request.method === 'GET') return send(200,{standards,officialTaiwan});
      if (url.pathname === '/api/official-tw') {
        if (request.method !== 'POST') return send(405,{error:'請使用 POST'}, {Allow:'POST'});
        if (!officialImages) return send(503,{error:'台灣教育部原圖資料未安裝，請參閱 README 的選用安裝說明。'});
        if (!request.headers['content-type']?.startsWith('application/json')) return send(415,{error:'請使用 application/json'});
        const body = await readJson(request);
        if (!body || typeof body.characters !== 'string' || Array.from(body.characters).length > 1000) return send(400,{error:'characters 須為最多 1000 個字元的字串'});
        const result = {};
        const missing = [];
        for (const c of new Set(Array.from(body.characters))) {
          if (!Object.hasOwn(officialImages,c)) { missing.push(c); continue; }
          const {png,width,height} = officialImages[c];
          const id = c.codePointAt(0);
          result[c] = {png,width,height,sourcePage:`${moeSource}dictView.jsp?ID=${id}`,viewerUrl:`${moeSource}dictFrame.jsp?ID=${id}`};
        }
        return send(200,{characters:result,missing});
      }
      if (url.pathname === '/api/strokes') {
        if (request.method !== 'POST') return send(405,{error:'請使用 POST'}, {Allow:'POST'});
        if (!request.headers['content-type']?.startsWith('application/json')) return send(415,{error:'請使用 application/json'});
        const body = await readJson(request);
        if (!body || typeof body.characters !== 'string' || Array.from(body.characters).length > 1000) return send(400,{error:'characters 須為最多 1000 個字元的字串'});
        if (!Object.hasOwn(datasets,body.standard)) return send(400,{error:'此地區字庫尚未安裝'});
        if (body.fallbackCn !== undefined && typeof body.fallbackCn !== 'boolean') return send(400,{error:'fallbackCn 須為布林值'});
        const result = {};
        const missing = [];
        for (const c of new Set(Array.from(body.characters))) {
          if (Object.hasOwn(datasets[body.standard], c)) result[c] = datasets[body.standard][c];
          else if (body.standard === 'tw' && body.fallbackCn && Object.hasOwn(datasets.cn,c)) result[c] = {...datasets.cn[c],isFallback:true};
          else missing.push(c);
        }
        return send(200,{characters:result,missing});
      }
      if (!['GET','HEAD'].includes(request.method)) return send(405,{error:'不支援的請求方式'}, {Allow:'GET, HEAD'});
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { return send(400,{error:'網址格式錯誤'}); }
      if (pathname.includes('\0') || pathname.includes('\\')) return send(400,{error:'網址格式錯誤'});
      const path = resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(publicRoot + sep)) return send(403,{error:'禁止存取'});
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return send(404,{error:'找不到頁面'});
      const content = await readFile(path);
      return send(200,content,{'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':pathname.startsWith('/fonts/') ? 'public, max-age=86400' : 'no-cache','Content-Length':content.length});
    } catch (error) {
      if (!response.headersSent && !response.destroyed) send(error.status || 500,{error:error.status ? error.message : '伺服器錯誤'});
      if (!error.status) console.error(error);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 須為 0–65535 的整數');
  const server = await createApp({dataDirectory:process.env.DATA_DIR || resolve(root,'data')});
  server.listen(port,host,() => console.log(`每日勤練字已啟動：http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
