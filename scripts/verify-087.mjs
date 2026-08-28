import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json")),platform=read("src/index.js"),worker=read("src/ronda/v285/index.js"),db=read("src/ronda/v285/database.js"),access=read("public/access-client.js"),admin=read("public/admin/admin.js"),design=read("public/design/index.html"),smart=read("public/design/smart-template-engine.js");
const checks=[
 ["version 0.8.7",pkg.version==="0.8.7"],
 ["reliability target 90",platform.includes("carouselTargetSuccessRate:0.90")],
 ["reliability ledger",db.includes("carousel_reliability")&&db.includes("getCarouselReliabilitySummary")],
 ["last 10 tracking",db.includes("ORDER BY completed_at DESC LIMIT 10")&&db.includes("recent10")],
 ["attempt metric",worker.includes("carousels_attempted")],
 ["queue final failure tracked",worker.includes("QUEUE_RETRIES_EXHAUSTED")],
 ["stale terminal tracked",worker.includes("JOB_STALE")],
 ["public reliability endpoint",worker.includes("/api/reliability/status")],
 ["stale cookie auto clear",worker.includes("X-Ronda-Session-Recovery")],
 ["access self recovery",access.includes("clearSessionAndRedirect")&&access.includes("validateSession")],
 ["BFCache revalidation",access.includes("pageshow")],
 ["admin 9/10 UI",admin.includes("meta 9/10")&&admin.includes("últimas 10 conclusões")],
 ["smart templates preserved",design.includes("smart-template-engine.js")&&smart.includes("semanticBinding")&&smart.includes("semanticSlot")],
 ["carousel recovery preserved",platform.includes("carouselRecoveryV0855")],
 ["39 sources preserved",platform.includes("registeredSources:39")],
 ["10 seats preserved",platform.includes("maximumActiveUsers:10")],
 ["email-only preserved",platform.includes("commonUserPbkdf2:false")],
];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`RONDA ONE v0.8.7: ${checks.length} verificações OK.`);
