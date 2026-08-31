import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { browserQuickActionArticle, classifyRenderedHtml, CAROUSEL_PIPELINE_VERSION, EVIDENCE_VERSION, ENGINE_BASELINE_VERSION, READER_VERSION } from "../src/production/hybrid-browser-reader.js";

const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const bytes=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url));
const exists=(p)=>fs.existsSync(new URL(`../${p}`,import.meta.url));
const sha=(value)=>crypto.createHash("sha256").update(value).digest("hex");

const pkg=JSON.parse(read("package.json"));
const lock=JSON.parse(read("src/production/carousel-stability-lock.json"));
const engine=read("src/production/engine.js");
const hybrid=read("src/production/hybrid-browser-reader.js");
const scraping=read("src/production/scraping-engine.js");
const worker=read("src/ronda/v285/index.js");
const platform=read("src/index.js");
const wrangler=JSON.parse(read("wrangler.jsonc"));

assert.equal(pkg.version,"0.9.7.6.0");
assert.equal(lock.engineBaseline,"0.9.7.5.6");
assert.equal(ENGINE_BASELINE_VERSION,"0.9.7.5.6");
assert.equal(READER_VERSION,"hybrid-reader-v1");
assert.equal(EVIDENCE_VERSION,"ronda-evidence-pack-v1-reader-v1");
assert.equal(CAROUSEL_PIPELINE_VERSION,"carousel-stability-baseline-v1");
assert.equal(lock.browserPolicy,"fallback-only-normal-path");
assert.equal(lock.browserNavigationsPerBrowserAttempt,1);
assert.equal(lock.d1SchemaChange,false);
assert.equal(lock.d1HistoryDeleted,false);

// O motor de scraping validado permanece congelado; a mudança de leitura Browser é isolada.
assert.equal(sha(bytes("src/production/scraping-engine.js")),"d5cd2aba4f110ff93f319e0e8f297f51db9478fb1c9dfbb48338cd8c4dc50357");
assert.equal(sha(bytes("src/ronda/v285/article-reader.js")),"944bff72b03f3c15a10e42a12541aef9af531c676801add27474a3b5165fc722");
assert.equal(sha(bytes("public/design/index.html")),"1af86252a341dd292218ef21aca97d6623d3a9d96ed6bff478d43b353195b156");
assert.match(scraping,/json-ld-fast/);
assert.match(scraping,/adapterExtract/);
assert.match(scraping,/amphtml/);
assert.match(scraping,/tryBrowserTransport/);
assert.match(scraping,/collected-fallback/);

// Browser: uma única navegação, JS habilitado, estabilização curta e sem networkidle.
let browserCalls=0;
let browserArgs=null;
const articleBody="<p>Conteúdo editorial de teste com fatos, contexto e informações verificáveis para o Evidence Pack.</p>".repeat(45);
const goodHtml=`<!doctype html><html><head><title>Teste</title></head><body><main><article><h1>Teste</h1>${articleBody}</article></main></body></html>`;
const env={
  BROWSER:{
    quickAction:async(action,args)=>{
      browserCalls+=1;
      assert.equal(action,"content");
      browserArgs=args;
      return new Response(goodHtml,{status:200,headers:{"content-type":"text/html","x-browser-ms-used":"321"}});
    }
  }
};
const rendered=await browserQuickActionArticle(env,"https://example.com/noticia",{timeoutMs:6000});
assert.equal(browserCalls,1);
assert.equal(browserArgs.gotoOptions.waitUntil,"domcontentloaded");
assert.ok(browserArgs.waitForTimeout>=650);
assert.equal(browserArgs.setJavaScriptEnabled,true);
assert.ok(browserArgs.rejectResourceTypes.includes("image"));
assert.ok(browserArgs.rejectResourceTypes.includes("media"));
assert.ok(browserArgs.rejectResourceTypes.includes("font"));
assert.ok(!browserArgs.rejectResourceTypes.includes("script"));
assert.ok(!browserArgs.rejectResourceTypes.includes("xhr"));
assert.ok(!browserArgs.rejectResourceTypes.includes("fetch"));
assert.equal(rendered.browserMsUsed,321);
assert.ok(["good","excellent"].includes(rendered.contentSufficiency.classification));
assert.doesNotMatch(hybrid,/networkidle[02]/);

const blocked=classifyRenderedHtml("<html><body><h1>Verify you are human</h1><div>captcha</div></body></html>");
assert.equal(blocked.classification,"blocked");
assert.equal(blocked.reason,"BOT_PROTECTION");

// Normal path continua direct-first; Browser só pode ser priorizado em retry explícito.
assert.doesNotMatch(engine,/getTransportPreference/);
assert.match(engine,/const transportPreference=\(retryMode==="alternate"\|\|retryMode==="deep"\)&&browserFetcher\?"browser-first":"direct-first"/);
assert.match(engine,/browserQuickActionArticle/);
assert.match(engine,/evidencePackageIsCurrent/);
assert.match(engine,/stampProductionInput/);
assert.match(engine,/readerVersion:input\?\.readerVersion\|\|null/);
assert.match(engine,/legacy_pipeline_preserved/);
assert.match(engine,/EVIDENCE_VERSION_MISMATCH/);

// Não reintroduzir os coordenadores 5.8/5.9 no retry manual.
const retryStart=engine.indexOf("export async function retryProductionJob");
const retryEnd=engine.indexOf("export async function generateProductionImage",retryStart);
assert.ok(retryStart>=0&&retryEnd>retryStart);
const retry=engine.slice(retryStart,retryEnd);
assert.doesNotMatch(retry,/ARTICLE_READ_QUEUE\.send/);
assert.doesNotMatch(retry,/CAROUSEL_AI_QUEUE\.send/);
assert.match(retry,/launchInteractiveProduction\(env,id,\{force:retryMode!==\'snapshot\',ctx,retryMode\}\)/);

// Código morto e locks antigos foram removidos.
for(const name of ["ensureEvidencePackPtBr","bestTopicItem","evidenceSyntheticHtml","translateArticleRecordToPtBr","splitTranslationText"]){
  assert.doesNotMatch(engine,new RegExp(`function\\s+${name}\\b`));
}
for(const path of lock.removedConflicts)assert.equal(exists(path),false,`${path} deveria ter sido removido`);

// Observabilidade e cache versionado.
assert.match(worker,/\/api\/admin\/carousel\/diagnostics/);
assert.match(engine,/browserDuration/);
assert.match(engine,/contentChars/);
assert.match(engine,/evidenceCount/);
assert.match(engine,/readerVersion/);
assert.match(engine,/pipelineVersion/);

// Quality-First/Cost Governor e cron separado permanecem.
assert.match(platform,/qualityFirstV09757/);
assert.match(platform,/costGovernorV09757/);
assert.match(platform,/crawlReadOnlyV09757/);
assert.match(platform,/carouselStabilityBaselineDefinitive/);
assert.doesNotMatch(platform,/carouselStabilityBaselineV097510/);
assert.doesNotMatch(platform,/carousel56FullLockV097512/);
assert.equal(wrangler.triggers.crons[0],"* * * * *");
assert.match(worker,/minute % 5 !== 0/);
assert.match(worker,/autoRecoverStaleProductionJobs\(env,\{limit:5,ctx\}\)/);

// Integridade da nova baseline.
for(const [file,expected] of Object.entries(lock.lockedFiles)){
  assert.equal(sha(bytes(file)),expected,`${file} divergiu do lock da baseline definitiva`);
}

console.log("RONDA ONE v0.9.7.6.0 Carousel Stability Baseline Definitiva: OK");
