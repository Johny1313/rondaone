import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const worker=read("src/ronda/v285/index.js");
const app=read("public/ronda/app.js");
const integration=read("public/ronda/ronda-one-integration.js");
const platform=read("src/index.js");
const wrangler=read("wrangler.jsonc");

assert.ok(worker.includes("async function rescueIntelligentCarouselJob"));
assert.ok(worker.includes("intelligentRescueRoute"));
assert.ok(worker.includes("/rescue$/i.exec(url.pathname)"));
assert.ok(worker.includes("JOB_LOCK_BUSY"));
assert.ok(worker.includes("getIntelligentCarousel(db, job.cacheKey)"));
assert.ok(worker.includes("ageMs:"));
assert.ok(worker.includes("idleMs:"));

assert.ok(app.includes("async function tryRescue(job)"));
assert.ok(app.includes("/rescue"));
assert.ok(app.includes("ageMs < 12_000") || app.includes("queuedStalled"));
assert.ok(app.includes("8 * 60_000"));
assert.ok(app.includes("__rondaNativeResilient = true"));
assert.ok(integration.includes("!waitForIntelligentJob.__rondaNativeResilient"));

assert.match(wrangler,/"queue": "ronda-one-intelligent-jobs"/);
assert.match(wrangler,/"max_concurrency": 2/);
assert.ok(platform.includes("carouselRecoveryV0855"));
assert.ok(platform.includes("rescueAfterQueuedSeconds:12"));

console.log("RONDA ONE v0.8.5.5 Carousel Recovery: OK");
