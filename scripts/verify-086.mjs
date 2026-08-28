import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const pkg=JSON.parse(read('package.json'));
const platform=read('src/index.js'),design=read('public/design/index.html'),engine=read('public/design/smart-template-engine.js'),projects=read('src/projects/service.js'),shell=read('src/ronda/shell.js');
const checks=[
 ['version 0.8.6',pkg.version==='0.8.6'],
 ['engine separate',engine.includes('RondaSmartTemplates')&&pkg.scripts.check.includes('smart-template-engine.js')],
 ['semantic content contract',projects.includes("contract:'ronda-content-model-v1'")&&projects.includes('contentModel,')],
 ['project contract v4',projects.includes('ronda-one-import-v4-semantic-content')],
 ['semantic slots',engine.includes("'TITLE','SUBTITLE','BODY','ROLE','SOURCE','IMAGE','IMAGE_CREDIT','CTA','SLIDE_NUMBER','EDITORIA'")],
 ['template saves all artboards',design.includes('templateProjectSnapshot')&&design.includes('compileTemplate(templateProjectSnapshot()')],
 ['click applies smart template',design.includes('applySmartTemplate(t)')],
 ['reapply',design.includes('reapplySmartTemplate')],
 ['detach',design.includes('detachSmartTemplate')],
 ['content model persisted',design.includes('rondaContentModel:clone(state.rondaContentModel)')],
 ['binding persisted',design.includes('templateBinding:clone(state.templateBinding)')],
 ['Ronda layers semantic',design.includes("semanticSlot:'IMAGE'")&&design.includes("'left','TITLE'")],
 ['autofit',engine.includes('function fitText')&&engine.includes('autoFitOverflow')],
 ['image fit',engine.includes("out.objectFit=out.objectFit||'cover'")],
 ['non destructive status',platform.includes('nonDestructive:true')],
 ['carousel recovery preserved',platform.includes('carouselRecoveryV0855')],
 ['email only preserved',platform.includes('commonUserPbkdf2:false')],
 ['39 sources preserved',platform.includes('registeredSources:39')],
 ['asset 086',platform.includes('2.8.5-086-smart-templates')],
 ['shell 086',shell.includes("PLATFORM_VERSION='0.8.6'")]
];
let failed=0;for(const [n,o] of checks){console.log(`${o?'OK':'FAIL'} - ${n}`);if(!o)failed++;}
if(failed)process.exit(1);console.log(`RONDA ONE v0.8.6: ${checks.length} checks OK`);
