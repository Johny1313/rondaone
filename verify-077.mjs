import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { rewriteRondaHtml, ASSET_REV, PLATFORM_VERSION } from '../src/ronda/shell.js';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

assert.equal(PLATFORM_VERSION,'0.7.7');
assert.equal(ASSET_REV,'2.8.5-077');

const sample=`<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body class="app"><button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button><script src="/app.js"></script></body></html>`;
const rewritten=rewriteRondaHtml(sample);
assert.match(rewritten,/id="rondaOneBar"/);
assert.match(rewritten,/id="openRondaDesign"/);
assert.match(rewritten,/\/ronda\/styles\.css\?v=2\.8\.5-077/);
assert.match(rewritten,/\/ronda\/app\.js\?v=2\.8\.5-077/);
assert.match(rewritten,/ronda-one-shell\.css\?v=0\.7\.7/);
assert.match(rewritten,/ronda-one-integration\.js\?v=0\.7\.7/);

const oldVersioned=`<html><head><link href="/ronda/styles.css?v=old"></head><body><script src="/ronda/app.js?v=old"></script></body></html>`;
const upgraded=rewriteRondaHtml(oldVersioned);
assert.match(upgraded,/\/ronda\/styles\.css\?v=2\.8\.5-077/);
assert.match(upgraded,/\/ronda\/app\.js\?v=2\.8\.5-077/);
assert.ok(!upgraded.includes('?v=old'));

const twice=rewriteRondaHtml(rewritten);
assert.equal((twice.match(/id="rondaOneBar"/g)||[]).length,1);
assert.equal((twice.match(/id="openRondaDesign"/g)||[]).length,1);
assert.equal((twice.match(/ronda-one-integration\.js/g)||[]).length,1);

const pkg=JSON.parse(await read('package.json'));
assert.equal(pkg.version,'0.7.7');
assert.match(pkg.devDependencies.wrangler,/\^4\.(?:2[0-9]|[3-9][0-9]|[1-9][0-9]{2,})\./);
const wrangler=JSON.parse(await read('wrangler.jsonc'));
assert.equal(wrangler.assets.binding,'ASSETS');
assert.ok(Array.isArray(wrangler.assets.run_worker_first));
assert.ok(wrangler.assets.run_worker_first.includes('/api/*'));
const roundConsumer=wrangler.queues.consumers.find(x=>x.queue==='ronda-one-round-jobs');
const intelligentConsumer=wrangler.queues.consumers.find(x=>x.queue==='ronda-one-intelligent-jobs');
assert.equal(roundConsumer.max_concurrency,1);
assert.equal(intelligentConsumer.max_concurrency,2);
const headers=await read('public/_headers');
assert.ok(!/ytimg/i.test(headers));
const index=await read('src/index.js');
assert.match(index,/version:'0\.7\.7'/);
assert.match(index,/assetCacheBust:'2\.8\.5-077'/);
const integration=await read('public/ronda/ronda-one-integration.js');
assert.match(integration,/const VERSION='0\.7\.7'/);
assert.match(integration,/window\.addEventListener\('online'/);
assert.match(integration,/clearStoredJob\(jobId\)/);
const projectService=await read('src/projects/service.js');
assert.match(projectService,/ronda-one-0\.7\.7/);
const readme=await read('README.md');
assert.match(readme,/RONDA ONE 0\.7\.7/);
assert.match(readme,/5167355d53ce9bbffa9bbd82a9b9b9094c68633d/);
const githubMarkup=`<!doctype html><html><head><link rel="stylesheet" href="/styles.css?v=2.8.5"></head><body><div class="modal-backdrop" id="carouselModal" hidden><button class="primary" id="copyCarousel" type="button" disabled>Copiar roteiro</button></div><script src="/app.js?v=2.8.5" defer></script></body></html>`;
const githubRewritten=rewriteRondaHtml(githubMarkup);
assert.match(githubRewritten,/id="openRondaDesign"/);
assert.match(githubRewritten,/\/ronda\/styles\.css\?v=2\.8\.5-077/);
assert.match(githubRewritten,/\/ronda\/app\.js\?v=2\.8\.5-077/);
const landing=await read('public/index.html');
assert.match(landing,/RONDA ONE 0\.7\.7/);
assert.match(landing,/href="\/ronda"/);
assert.match(landing,/href="\/design\/"/);
assert.match(landing,/href="\/projects\/"/);

for(const file of [
  'src/index.js',
  'src/ronda/router.js',
  'src/ronda/shell.js',
  'src/projects/service.js',
  'src/ai/service.js',
  'public/ronda/ronda-one-integration.js'
]){
  execFileSync(process.execPath,['--check',new URL(file,root).pathname],{stdio:'pipe'});
}

console.log('RONDA ONE 0.7.7: verificação local concluída com sucesso.');
