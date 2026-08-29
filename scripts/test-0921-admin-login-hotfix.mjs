import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const hotfix=read('src/ronda/admin-auth-hotfix.js');
const profile=read('src/ronda/v285/profile.js');
const platform=read('src/index.js');
const shell=read('src/ronda/shell.js');

assert.match(profile,/export const SESSION_COOKIE_NAME\s*=\s*["']ronda_session["']/);
assert.match(hotfix,/import\s*\{[\s\S]*?SESSION_COOKIE_NAME[\s\S]*?\}\s*from\s*["']\.\/v285\/profile\.js["']/);
assert.match(hotfix,/parseCookies\(request\.headers\.get\(["']Cookie["']\)\)\[SESSION_COOKIE_NAME\]/);
assert.match(platform,/version:'0\.9\.2\.1'/);
assert.match(platform,/adminLoginHotfixV0921/);
assert.match(platform,/sessionCookieNameImported:true/);
assert.match(shell,/PLATFORM_VERSION='0\.9\.2\.1'/);

console.log('RONDA ONE v0.9.2.1 Admin Login Hotfix: OK');
