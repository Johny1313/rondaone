import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code=fs.readFileSync(new URL("../public/ronda/editorial-mesa-filters.js",import.meta.url),"utf8");
const sandbox={globalThis:{}};
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
const rules=sandbox.globalThis.RondaMesaFilters;
assert.ok(rules);

const now=Date.now();
const events=[
  {eventId:"a",status:"BREAKING",tracao:{score:82},materias:[{region:"Brasil"}],ultimaAtualizacao:new Date(now-5*60000).toISOString(),mudouDesdeUltimaRonda:true},
  {eventId:"b",status:"NOVO",tracao:{score:40},materias:[{region:"Brasil"}],ultimaAtualizacao:new Date(now-10*60000).toISOString(),mudouDesdeUltimaRonda:true},
  {eventId:"c",status:"ATUALIZADO",tracao:{score:55},materias:[{region:"Mundo"}],ultimaAtualizacao:new Date(now-20*60000).toISOString(),mudouDesdeUltimaRonda:true},
  {eventId:"d",status:"ESTÁVEL",tracao:{score:78},materias:[{region:"Mundo"}],ultimaAtualizacao:new Date(now-30*60000).toISOString(),termosMonitorados:["OpenAI"]},
  {eventId:"e",status:"ESTÁVEL",tracao:{score:10},materias:[{region:"Brasil"}],ultimaAtualizacao:new Date(now-40*60000).toISOString()},
];

assert.equal(rules.filterEvents(events,"BREAKING").length,1);
assert.equal(rules.filterEvents(events,"EM ALTA").length,2); // breaking + tração >=75
assert.equal(rules.filterEvents(events,"EM DESENVOLVIMENTO").length,2); // NOVO + ATUALIZADO
assert.equal(rules.filterEvents(events,"MONITORADO").length,1);
assert.equal(rules.filterEvents(events,"BRASIL").length,3);
assert.equal(rules.filterEvents(events,"MUNDO").length,2);
assert.equal(rules.filterEvents(events,"ULTIMAS",{latestLimit:3}).length,3);
assert.equal(rules.filterEvents(events,"ULTIMAS",{latestLimit:3})[0].eventId,"a");

const linked=[{eventId:"a"},{eventId:"c"},{eventId:"e"}];
assert.equal(rules.filterLinked(linked,events,"MUNDO").length,1);
assert.equal(rules.counts(events)["TODOS"],5);
assert.equal(rules.summary(rules.filterEvents(events,"BRASIL")).events,3);

console.log("RONDA ONE v0.8.9 Mesa Filters: OK");
