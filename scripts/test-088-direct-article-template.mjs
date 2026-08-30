import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const db=read("src/ronda/v285/database.js");
const worker=read("src/ronda/v285/index.js");
const reader=read("src/ronda/v285/article-reader.js");
const design=read("public/design/index.html");
const platform=read("src/index.js");

assert.match(db,/request_json TEXT/);
assert.match(db,/ensureIntelligentJobRequestColumn/);
assert.match(db,/requestPayload = null/);
assert.match(db,/request_json = excluded\.request_json/);
assert.match(db,/request,/);

assert.match(worker,/\/api\/design\/article-carousel/);
assert.match(worker,/mode: "direct-article-url"/);
assert.match(worker,/requestPayload:/);
assert.match(worker,/validateArticleUrl/);
assert.match(worker,/(?:INTELLIGENT_JOBS_QUEUE\.send|carouselQueue\(env\)\.send)/);
assert.match(worker,/startCarouselReliabilityAttempt/);
assert.match(worker,/requestTopic = job\?\.request\?\.topic/);
assert.match(worker,/articleVisuals: data\?\.reading\?\.selectedSource\?\.images/);

assert.match(reader,/selectedRecord\?\.title/);

assert.match(design,/id="directArticleUrl"/);
assert.match(design,/id="directArticleTemplate"/);
assert.match(design,/id="directArticleSlides"/);
assert.match(design,/generateDirectArticleCarousel/);
assert.match(design,/waitDirectArticleJob/);
assert.match(design,/\/api\/design\/article-carousel/);
assert.match(design,/\/api\/free-images/);
assert.match(design,/applySmartTemplate\(template\)/);
assert.match(design,/publisherVisualsFromCarousel/);
assert.match(design,/freeVisualsForDirectArticle/);

assert.match(platform,/directArticleComposerV088/);
assert.match(platform,/sameEditorialPipeline:true/);
assert.match(platform,/generativeImageFallback:false/);

console.log("RONDA ONE v0.8.8 Direct Article Template: OK");
