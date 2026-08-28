import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const app=read("public/ronda/app.js");
const html=read("public/ronda/index.html");
const platform=read("src/index.js");
const shell=read("src/ronda/shell.js");

const checks=[
 ["version 0.8.5.3",pkg.version==="0.8.5.3"],
 ["app syntax included in check",pkg.scripts.check.includes("node --check public/ronda/app.js")],
 ["escaped profile newlines removed",!app.includes("activeProfileReferenceType='text';\\\\nfunction")],
 ["profile JS valid structure",app.includes("function setProfileReferenceTab(type)")],
 ["search type search",/id="searchInput"[^>]*type="search"/.test(html)],
 ["search readonly autofill guard",/id="searchInput"[^>]*readonly/.test(html)],
 ["search JS guard",app.includes("clearUnexpectedSearchAutofill")&&app.includes("searchUserActivated")],
 ["startup latest force preserved",app.includes('loadLatest({ quiet: true, force: true })')],
 ["state data apply guard preserved",app.includes("!state.data || !state.lastRunId")],
 ["frontend boot error visible",app.includes("RONDA ONE frontend boot failed")],
 ["paid full 39 pipeline preserved",platform.includes("registeredSources:39")&&platform.includes("oneSourcePerRound:false")],
 ["admin secret auth preserved",platform.includes("mode:'cloudflare-secret'")],
 ["carousel stability preserved",platform.includes("carouselStabilityV083")],
 ["source recovery preserved",platform.includes("sourceRecovery:{")],
 ["asset 0853",platform.includes("2.8.5-0853-frontend-recovery")],
 ["shell 0853",shell.includes("PLATFORM_VERSION='0.8.5.3'")]
];

let failed=0;
for(const [name,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`\nRONDA ONE v0.8.5.3: ${checks.length} verificações OK.`);
