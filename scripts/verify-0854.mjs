import fs from "node:fs";
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const pkg=JSON.parse(read("package.json"));
const worker=read("src/ronda/v285/index.js");
const html=read("public/ronda/index.html");
const app=read("public/ronda/app.js");
const platform=read("src/index.js");
const shell=read("src/ronda/shell.js");

const checks=[
 ["version 0.8.5.4",pkg.version==="0.8.5.4"],
 ["common no pbkdf2",worker.includes("passwordIterations: 0")&&!worker.includes("internalCredentials = await hashPassword")],
 ["email-only marker",worker.includes("email-only:")],
 ["password register removed",worker.includes("Cadastro por senha foi removido")],
 ["profile password removed",worker.includes("Senha de perfil não é utilizada")],
 ["account tab removed",!html.includes('data-profile-ref-tab="account"')],
 ["password form removed",!html.includes('id="changePasswordForm"')],
 ["password JS removed",!app.includes("changeProfilePassword")&&!app.includes("profileAccountPanel")],
 ["admin Cloudflare secret preserved",platform.includes("mode:'cloudflare-secret'")],
 ["commonUserPbkdf2 false",platform.includes("commonUserPbkdf2:false")],
 ["frontend recovery preserved",app.includes("clearUnexpectedSearchAutofill")&&app.includes('loadLatest({ quiet: true, force: true })')],
 ["39 source pipeline preserved",platform.includes("registeredSources:39")&&platform.includes("oneSourcePerRound:false")],
 ["carousel stability preserved",platform.includes("carouselStabilityV083")],
 ["10 seats preserved",platform.includes("maximumActiveUsers:10")],
 ["asset 0854",platform.includes("2.8.5-0854-email-only-auth")],
 ["shell 0854",shell.includes("PLATFORM_VERSION='0.8.5.4'")]
];

let failed=0;
for(const [name,ok] of checks){console.log(`${ok?"OK":"FAIL"} - ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);
console.log(`\nRONDA ONE v0.8.5.4: ${checks.length} verificações OK.`);
