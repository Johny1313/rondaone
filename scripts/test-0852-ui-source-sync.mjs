import assert from "node:assert/strict";
import fs from "node:fs";
import { translateRoundPayload } from "../src/ronda/v285/translation.js";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const router=read("src/ronda/router.js"),collector=read("src/ronda/v285/collector.js"),app=read("public/ronda/app.js"),index=read("src/index.js");
assert.doesNotMatch(router,/runFreeRoundQueue/); assert.match(router,/rondaWorker\.queue/); assert.match(router,/legacyFree/);
assert.match(collector,/function effectiveNextCheckAt/);
// v0.9.0 reduz somente a Fast Lane para 1 min; o mecanismo de recuperação permanece.
assert.match(collector,/function adaptiveSourceRefreshMinutes/); assert.match(collector,/if \(!healthy\) return Math\.max\(5, Number\(feed\?\.refreshMinutes\) \|\| 10\)/);
assert.match(collector,/Math\.min\(15, retryBackoffMinutes/);
assert.match(app,/conditionalApi\("\/api\/latest"/); assert.match(app,/if \(payload\?\.ok\) applyRound/); assert.match(app,/loadLatest\(\{ quiet: true, force: true \}\)/); assert.match(app,/function syncLatestRound/);
assert.match(index,/oneSourcePerRound:false/);
const payload={ok:true,items:[{id:"w1",title:"International headline",description:"International description",sourceName:"BBC News",collectorName:"BBC News",region:"Mundo",kind:"portal",publishedAt:new Date().toISOString(),url:"https://example.test/a"}],sources:[{id:"bbc",name:"BBC News",region:"Mundo",ok:true,count:1,error:null,warning:null}]};
const translated=await translateRoundPayload(payload,{ai:null,db:null}); const bbc=translated.sources.find(s=>s.id==="bbc");
assert.equal(bbc.ok,true); assert.equal(bbc.collectedCount,1); assert.equal(bbc.count,0); assert.equal(bbc.translation,"pending"); assert.equal(bbc.translationPendingCount,1);
console.log("RONDA ONE v0.8.5.2 UI + Source Sync: OK");
