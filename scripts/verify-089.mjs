import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const mesa=read("public/ronda/editorial-mesa.js");
const rules=read("public/ronda/editorial-mesa-filters.js");
const css=read("public/ronda/editorial-mesa.css");
const shell=read("src/ronda/shell.js");
const platform=read("src/index.js");

const checks=[
 ["version 0.8.9",pkg.version==="0.8.9"],
 ["filter rules module",rules.includes("RondaMesaFilters")&&rules.includes("filterLinked")],
 ["Breaking rule",rules.includes("selected==='BREAKING'")],
 ["Hot traction rule",rules.includes("score||0)>=75")],
 ["Development broad rule",rules.includes("DEVELOPMENT_STATUSES")],
 ["Region rules",rules.includes("hasRegion(event,'BRASIL')")&&rules.includes("hasRegion(event,'MUNDO')")],
 ["Latest top 20",rules.includes("latestLimit=20")],
 ["whole Mesa render",mesa.includes("renderFilteredMesa")],
 ["linked panels",mesa.includes("renderChanges(linkedItems(changes))")&&mesa.includes("renderAlerts(linkedItems(alerts))")],
 ["counts UI",mesa.includes("data-filter-count")&&mesa.includes("updateFilterButtons")],
 ["ARIA active",mesa.includes("aria-pressed")],
 ["count CSS",css.includes(".event-filter b")],
 ["rules before Mesa",shell.includes("EDITORIAL_MESA_FILTERS_SCRIPT")&&shell.indexOf("EDITORIAL_MESA_FILTERS_SCRIPT")<shell.indexOf("EDITORIAL_MESA_SCRIPT")],
 ["platform metadata",platform.includes("mesaFiltersV089")],
 ["Direct Article preserved",platform.includes("directArticleComposerV088")],
 ["Reliability 90 preserved",platform.includes("reliabilityV087")],
 ["Carousel Recovery preserved",platform.includes("carouselRecoveryV0855")],
 ["39 sources preserved",platform.includes("registeredSources:39")],
];

let failed=0;
for(const [name,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`RONDA ONE v0.8.9: ${checks.length} verificações OK.`);
