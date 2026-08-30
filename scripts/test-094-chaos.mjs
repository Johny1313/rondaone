import assert from 'node:assert/strict';
import { classifyReliabilityError, withReliabilityRetry } from '../src/reliability/core.js';
const cases=[new Error('network fetch failed'),new Error('HTTP 503'),new Error('timeout')];
for(const error of cases)assert.equal(classifyReliabilityError(error).retryable,true);
let calls=0;const result=await withReliabilityRetry(async()=>{calls+=1;if(calls<4)throw cases[(calls-1)%cases.length];return {ok:true,fallbackRecovered:true};},{attempts:4,delaysMs:[0,0,0,0]});
assert.equal(result.ok,true);assert.equal(calls,4);
console.log('RONDA ONE v0.9.4 Chaos local: transient failures recovered');
