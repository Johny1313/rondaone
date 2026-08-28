import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const worker=read("src/ronda/v285/index.js");
const app=read("public/ronda/app.js");
const integration=read("public/ronda/ronda-one-integration.js");
const platform=read("src/index.js");
const shell=read("src/ronda/shell.js");

const checks=[
 ["version 0.8.5.5",pkg.version==="0.8.5.5"],
 ["rescue backend",worker.includes("rescueIntelligentCarouselJob")&&worker.includes("intelligentRescueRoute")],
 ["rescue requires login",worker.includes("const { user } = await requireEditorialUser(request, env)")],
 ["rescue lock safe",worker.includes("JOB_LOCK_BUSY")],
 ["cache recovery preserved",worker.includes("getIntelligentCarousel(db, job.cacheKey)")],
 ["job age diagnostics",worker.includes("ageMs:")&&worker.includes("idleMs:")],
 ["native 8m polling",app.includes("8 * 60_000")&&app.includes("__rondaNativeResilient = true")],
 ["automatic rescue 12s",app.includes("ageMs < 12_000")&&app.includes("/rescue")],
 ["integration does not override native",integration.includes("!waitForIntelligentJob.__rondaNativeResilient")],
 ["queue concurrency 2 preserved",platform.includes("intelligentQueueConcurrency:2")],
 ["email-only auth preserved",platform.includes("commonUserPbkdf2:false")],
 ["39 source pipeline preserved",platform.includes("registeredSources:39")],
 ["frontend recovery preserved",platform.includes("frontendSyntaxGuard:true")],
 ["carousel recovery telemetry",platform.includes("carouselRecoveryV0855")],
 ["asset 0855",platform.includes("2.8.5-0855-carousel-recovery")],
 ["shell 0855",shell.includes("PLATFORM_VERSION='0.8.5.5'")]
];

let failed=0;
for(const [name,ok] of checks){
  console.log(`${ok?"OK":"FAIL"} - ${name}`);
  if(!ok)failed++;
}
if(failed)process.exit(1);
console.log(`\nRONDA ONE v0.8.5.5: ${checks.length} verificações OK.`);
