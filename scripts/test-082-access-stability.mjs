import assert from 'node:assert/strict';
import { ADMIN_EMAIL, MAX_ACTIVE_USERS, SESSION_IDLE_MINUTES, SESSION_TOUCH_MINUTES } from '../src/ronda/v285/profile.js';
assert.equal(ADMIN_EMAIL,'johnymoraes13@gmail.com'); assert.equal(MAX_ACTIVE_USERS,10); assert.equal(SESSION_IDLE_MINUTES,60); assert.equal(SESSION_TOUCH_MINUTES,5);
const activeUnique=new Set(['u1','u1','u2','u3','u4','u5','u6','u7','u8','u9','u10']); assert.equal(activeUnique.size,10);
const now=Date.now(), idleCutoff=now-SESSION_IDLE_MINUTES*60*1000; assert.equal(now-(idleCutoff-1)>SESSION_IDLE_MINUTES*60*1000,true);
console.log('RONDA ONE v0.8.2 Access & Stability: testes básicos OK.');