import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const design=read("public/design/index.html");
const platform=read("src/index.js");
const shell=read("src/ronda/shell.js");

assert.match(design,/id="exportAllBtn"/);
assert.match(design,/Baixar todos os slides/);
assert.match(design,/async function exportAllBoards/);
assert.match(design,/async function exportCurrentBoard/);
assert.match(design,/markEditorialProductionComplete\(\{silent:true\}\)/);
assert.match(design,/Não foi possível atualizar a Mesa, mas o download foi liberado/);
assert.match(design,/triggerBlobDownload\(blob,boardExportName\(board,i,boards.length\)\)/);
assert.match(platform,/formaDownloadFlowV097410/);
assert.match(shell,/(?:0\.9\.7\.4\.(?:10-forma-download-all-slides|11-newsroom-os-phase-1|12-newsroom-os-hardening)|0\.9\.7\.5(?:-adaptive-retry-no-repeat|\.1-unified-no-hang-coordinator))/);

console.log("RONDA ONE v0.9.7.4.10 FORMA Download Flex + All Slides: OK");
