import fs from "node:fs";
import { FEED_COUNTS } from "../src/ronda/v285/collector.js";
const read=(p)=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const index=read("src/index.js"),shell=read("src/ronda/shell.js"),worker=read("src/ronda/v285/index.js"),db=read("src/ronda/v285/database.js"),wrangler=read("wrangler.jsonc"),client=read("public/ronda/ronda-one-integration.js"),access=read("public/access-client.js");
const checks=[
["version 0.8.3",pkg.version==="0.8.3"],
["39 sources preserved",FEED_COUNTS.total===39],
["10 users preserved",index.includes("maximumActiveUsers:10")],
["idle 60m preserved",index.includes("idleLogoutMinutes:60")],
["source recovery preserved",index.includes("sourceRecovery:{")],
["queue concurrency 2",/"ronda-one-intelligent-jobs"[\s\S]*?"max_concurrency": 2/.test(wrangler)],
["queue retries 5",/"ronda-one-intelligent-jobs"[\s\S]*?"max_retries": 5/.test(wrangler)],
["queued stale 5m",db.includes('row.status === "queued"')&&db.includes("5 * 60 * 1000")],
["running stale 3m",db.includes('row.status === "running"')&&db.includes("3 * 60 * 1000")],
["terminal immutable",db.includes("status NOT IN ('succeeded','failed')")],
["cache recovery",worker.includes("intelligent_job_recovered_from_cache")],
["lock retry",worker.includes("JOB_LOCK_BUSY")],
["lock renewal",worker.includes("renewLock(db, lock, INTELLIGENT_JOB_LOCK_TTL_MS)")],
["five app retries",worker.includes("INTELLIGENT_QUEUE_MAX_ATTEMPTS = 5")],
["poll 1500",worker.includes("pollAfterMs: 1500")&&client.includes("pollAfterMs=1500")],
["adaptive polling",client.includes("return 2200")&&client.includes("return 3500")],
["network errors preserve job",!client.includes("transientErrors>=5")],
["final poll",client.includes("?final=1")],
["asset 083",index.includes("2.8.5-083-carousel-stability")],
["shell 083",shell.includes("PLATFORM_VERSION='0.8.3'")],
["low frequency access preserved",access.includes("5*60*1000")]
];
let failed=0;
for(const [n,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${n}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`\nRONDA ONE v0.8.3: ${checks.length} verificações OK.`);
