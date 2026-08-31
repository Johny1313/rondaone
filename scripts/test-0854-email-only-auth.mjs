import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const worker=read("src/ronda/v285/index.js");
const html=read("public/ronda/index.html");
const app=read("public/ronda/app.js");
const platform=read("src/index.js");

const commonStart=worker.indexOf('if (emailKey === ADMIN_EMAIL) throw');
const commonEnd=worker.indexOf('if (url.pathname === "/api/auth/logout"',commonStart);
const common=worker.slice(commonStart,commonEnd);

assert.match(common,/email-only:/);
assert.match(common,/passwordIterations: 0/);
assert.doesNotMatch(common,/internalCredentials = await hashPassword/);
assert.match(worker,/Cadastro por senha foi removido/);
assert.match(worker,/Senha de perfil não é utilizada/);
assert.doesNotMatch(html,/data-profile-ref-tab="account"/);
assert.doesNotMatch(html,/id="changePasswordForm"/);
assert.doesNotMatch(app,/changeProfilePassword/);
assert.doesNotMatch(app,/profileAccountPanel/);
assert.match(platform,/commonUserPbkdf2:false/);
assert.match(platform,/mode:'cloudflare-secret'/);

console.log("RONDA ONE v0.8.5.4 Email-only Auth: OK");
