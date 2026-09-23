import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApp } from '../server.js';

let server, base, dataDirectory;
before(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(),'worksheet-default-data-'));
  for (const region of ['cn','tw']) await copyFile(new URL(`../data/${region}.json.gz`,import.meta.url),join(dataDirectory,`${region}.json.gz`));
  server = await createApp({dataDirectory});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (dataDirectory) await rm(dataDirectory,{recursive:true,force:true});
});

test('serves the UI, correct JS and font MIME types, and health status', async () => {
  for (const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/style.css','text/css'],['/fonts/WorksheetKai.ttf','font/ttf'],['/fonts/AnimCJKWorksheet.otf','font/otf']]) {
    const response = await fetch(base+path);
    assert.equal(response.status,200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    await response.arrayBuffer();
  }
  const health = await fetch(base+'/healthz');
  assert.deepEqual(await health.json(),{status:'ok'});
});

test('metadata discloses installed regional coverage', async () => {
  const response = await fetch(base+'/api/meta');
  const {standards} = await response.json();
  assert.equal(standards.cn.count,9574);
  assert.equal(standards.tw.count,1013);
  assert.equal(standards.tw.label,'AnimCJK 繁體（台灣）');
});

test('stroke API returns real cumulative path data and explicit missing characters', async () => {
  const response = await fetch(base+'/api/strokes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characters:'永𠮷A',standard:'cn'})});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.characters['永'].paths.length,5);
  assert.ok(result.missing.includes('A'));
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('Taiwan stroke API keeps AnimCJK first and marks mainland fallback per character', async () => {
  const request = async (standard, fallbackCn) => {
    const response = await fetch(base+'/api/strokes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characters:'為甚麼𠮷',standard,fallbackCn})});
    assert.equal(response.status,200);
    return response.json();
  };
  const merged = await request('tw',true);
  assert.equal(merged.characters['為'].paths.length,9);
  assert.equal(merged.characters['甚'].paths.length,9);
  assert.equal(merged.characters['甚'].isFallback,true);
  assert.equal(merged.characters['麼'].paths.length,14);
  assert.equal(merged.characters['為'].isFallback,undefined);
  assert.equal(merged.characters['麼'].isFallback,undefined);
  assert.deepEqual(merged.missing,['𠮷']);
  const original = await request('tw',false);
  assert.deepEqual(original.missing,['甚','𠮷']);
  assert.equal(original.characters['甚'],undefined);
  const mainland = await request('cn',true);
  assert.equal(mainland.characters['為'].paths.length,12);
  assert.equal(mainland.characters['甚'].isFallback,undefined);
});

test('malformed API input is rejected without breaking subsequent requests', async () => {
  for (const [body,status] of [['{',400],['null',400],[JSON.stringify({characters:'一',standard:'__proto__'}),400],[JSON.stringify({characters:'一',standard:'tw',fallbackCn:'true'}),400],[JSON.stringify({characters:'天'.repeat(1001),standard:'cn'}),400]]) {
    const response = await fetch(base+'/api/strokes',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(response.status,status);
    await response.text();
  }
  assert.equal((await fetch(base+'/healthz')).status,200);
});

test('private files cannot be retrieved and methods are restricted', async () => {
  for (const path of ['/server.js','/package.json','/data/cn.json.gz','/..%2Fpackage.json','/%2e%2e%2fserver.js']) {
    const response = await fetch(base+path);
    assert.ok([403,404].includes(response.status));
    await response.text();
  }
  assert.equal((await fetch(base+'/api/strokes')).status,405);
  assert.equal((await fetch(base+'/',{method:'POST',body:'x'})).status,405);
});

test('official Taiwan metadata reports an uninstalled optional image collection', async () => {
  const response = await fetch(base+'/api/meta');
  const {officialTaiwan,standards} = await response.json();
  assert.deepEqual(officialTaiwan,{
    available:false,
    count:0,
    label:'台灣教育部全筆順提示（原圖）',
    licenseUrl:'https://creativecommons.org/licenses/by-nc-nd/3.0/tw/',
    sourceUrl:'https://stroke-order.learningweb.moe.edu.tw/',
  });
  assert.equal(Object.hasOwn(standards,'moe'),false);
  const notice = await fetch(base+'/licenses/MOE-NOTICE.txt');
  assert.equal(notice.status,200);
  assert.match(await notice.text(),/71ab4ab4f48c8503095819a88f0032b8408b1705afe89902196cc0be8d3fbfc3/);
});

test('official Taiwan API explains when the optional images are absent', async () => {
  const response = await fetch(base+'/api/official-tw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({characters:'永'})});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/未安裝/);
  const wrongMethod = await fetch(base+'/api/official-tw');
  assert.equal(wrongMethod.status,405);
  assert.equal(wrongMethod.headers.get('allow'),'POST');
  assert.equal((await fetch(base+'/healthz')).status,200);
});

test('installing an optional image collection enables the original-image API', async () => {
  const directory = await mkdtemp(join(tmpdir(),'worksheet-moe-installed-'));
  let installed;
  try {
    for (const region of ['cn','tw']) await copyFile(new URL(`../data/${region}.json.gz`,import.meta.url),join(directory,`${region}.json.gz`));
    const original = Buffer.from('synthetic original PNG bytes for API fixture');
    const png = original.toString('base64');
    await writeFile(join(directory,'moe.json.gz'),gzipSync(JSON.stringify({
      '永':{png,width:50,height:725},
      '裡':{png,width:95,height:725},
      '𥑮':{png,width:140,height:725},
    })));
    installed = await createApp({dataDirectory:directory});
    installed.listen(0,'127.0.0.1');
    await once(installed,'listening');
    const localBase = `http://127.0.0.1:${installed.address().port}`;
    const {officialTaiwan} = await (await fetch(localBase+'/api/meta')).json();
    assert.equal(officialTaiwan.available,true);
    assert.equal(officialTaiwan.count,3);
    const request = body => fetch(localBase+'/api/official-tw',{method:'POST',headers:{'Content-Type':'application/json'},body});
    const response = await request(JSON.stringify({characters:'永裡裏𥑮A永裏'}));
    assert.equal(response.status,200);
    const {characters,missing} = await response.json();
    assert.deepEqual(Object.keys(characters),['永','裡','𥑮']);
    assert.deepEqual(missing,['裏','A']);
    assert.deepEqual(Buffer.from(characters['永'].png,'base64'),original);
    assert.equal(characters['永'].width,50);
    assert.equal(characters['永'].sourcePage,'https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=27704');
    assert.equal(characters['𥑮'].viewerUrl,'https://stroke-order.learningweb.moe.edu.tw/dictFrame.jsp?ID=152686');
    assert.equal(Object.hasOwn(characters['永'],'paths'),false);
    assert.equal(response.headers.get('cache-control'),'no-store');
    for (const body of ['{','null','[]','{}',JSON.stringify({characters:42}),JSON.stringify({characters:'永'.repeat(1001)}),JSON.stringify({characters:'𥑮'.repeat(1001)})]) {
      assert.equal((await request(body)).status,400);
    }
    const boundary = await request(JSON.stringify({characters:'𥑮'.repeat(1000)}));
    assert.equal(boundary.status,200);
    assert.deepEqual(Object.keys((await boundary.json()).characters),['𥑮']);
    const empty = await request(JSON.stringify({characters:''}));
    assert.deepEqual(await empty.json(),{characters:{},missing:[]});
    assert.equal((await fetch(localBase+'/api/official-tw',{method:'POST',body:'永'})).status,415);
  } finally {
    installed?.closeAllConnections();
    if (installed?.listening) await new Promise(resolve => installed.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});

test('official integration permits the intended viewer and form without exposing private data', async () => {
  const response = await fetch(base+'/healthz');
  const policy = response.headers.get('content-security-policy');
  for (const directive of ["default-src 'self'","connect-src 'self'","frame-src https://stroke-order.learningweb.moe.edu.tw","form-action 'self' https://www.edbchinese.hk","object-src 'none'","frame-ancestors 'none'"]) {
    assert.ok(policy.split('; ').includes(directive));
  }
  const privateData = await fetch(base+'/data/moe.json.gz');
  assert.equal(privateData.status,404);
});

test('startup fails explicitly when an installed optional image collection is corrupted', async () => {
  const directory = await mkdtemp(join(tmpdir(),'worksheet-moe-corrupt-'));
  try {
    for (const region of ['cn','tw']) await writeFile(join(directory,`${region}.json.gz`),gzipSync('{}'));
    await writeFile(join(directory,'moe.json.gz'),'not a gzip file');
    await assert.rejects(createApp({dataDirectory:directory}),/無法載入台灣教育部全筆順提示原圖/);
  } finally {
    await rm(directory,{recursive:true,force:true});
  }
});
