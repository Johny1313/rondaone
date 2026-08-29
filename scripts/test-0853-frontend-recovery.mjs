import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const app=read("public/ronda/app.js");
const html=read("public/ronda/index.html");
const pkg=JSON.parse(read("package.json"));

assert.match(pkg.version,/^0\.(?:8\.(?:5\.(?:3|[4-9]|\d{2,})|[6-9](?:\.\d+)?)|9\.\d+(?:\.\d+)?)$/);

// O bug real da 0.8.5.2.
assert.doesNotMatch(app,/activeProfileReferenceType='text';\\nfunction/);
assert.match(app,/let activeProfileReferenceType='text';\nfunction setProfileReferenceTab/);

// Busca não recebe e-mail do autofill.
assert.match(html,/id="searchInput"[^>]*type="search"/);
assert.match(html,/id="searchInput"[^>]*readonly/);
assert.match(app,/function clearUnexpectedSearchAutofill/);
assert.match(app,/searchInput\.value = ""/);
assert.match(app,/state\.query = ""/);

// Última ronda continua sendo forçada no boot.
assert.match(app,/loadLatest\(\{ quiet: true, force: true \}\)/);
assert.match(app,/if \(payload\?\.ok\) applyRound/);

// App principal agora faz parte do npm check.
assert.match(pkg.scripts.check,/node --check public\/ronda\/app\.js/);

// Todos os getElementById usados diretamente em addEventListener precisam existir.
const ids=new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]));
const direct=[...app.matchAll(/document\.getElementById\(["']([^"']+)["']\)\.addEventListener/g)].map(m=>m[1]);
for(const id of direct) assert.ok(ids.has(id),`ID ausente no HTML: ${id}`);

console.log("RONDA ONE v0.8.5.3 Frontend Recovery: OK");
