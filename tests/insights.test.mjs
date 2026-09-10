import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceEvent, viewOf } from '../src/insights/engine.mjs';
import { alertsOf, limitsOf, mergeModels, scanSessions } from '../src/insights/presentation.mjs';
const event = (type, seq, time, data = {}) => ({ type, seq, time, data });
const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, reasoningTokens: 3, totalTokens: 35 };
function fixture(extra = []) { return [event('request/header', 0, 0, { header: { config: { provider: 'p', model: 'a' } } }), event('turn/start', 1, 1, { turn: 1 }), event('step/start', 2, 10, { turn: 1, step: 1 }), ...extra]; }
const fold = (events, state = initialState({ id: 's' })) => events.reduce(reduceEvent, state);
const complete = (seq=3, report=usage, model='a') => event('assistant/message',seq,100,{turn:1,step:1,usage:report,message:{source:{kind:'model',provider:'p',model},role:'assistant',content:[]}});
function call(seq, id, args='{"command":"x"}') { return event('tool/call',seq,seq*100,{turn:1,step:1,callId:id,name:'bash',arguments:args}); }
function result(seq,id,failed=true,content='denied',error) { return event('tool/result',seq,seq*100,{turn:1,step:1,message:{id:`message-${id}`,role:'user',source:{kind:'tool',callId:id},content:[{type:'tool-result',toolCallId:id,isError:failed,content:[{type:'text',text:content}]}]},...(error?{error}:{} )}); }
function failures(repeat=true) { const rows=fixture([complete()]); for(let i=0;i<3;i++) rows.push(call(4+2*i,`c${i}`,repeat?'{"command":"x"}':JSON.stringify({command:`x${i}`})),result(5+2*i,`c${i}`));return rows; }
test('usage chunk and final message are charged once despite replay',()=>{const s=fold(fixture([event('assistant/chunk',3,20,{turn:1,step:1,chunk:{type:'usage',usage}}),complete(4),event('step/end',5,120,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,1);assert.equal(s.totals.tokens,35);assert.equal(s.totals.reasoning,3);});
test('canonical RC1 flat call and nested ToolResultMessage pair correctly',()=>{const s=fold(fixture([complete(),call(4,'c'),result(5,'c')]));assert.equal(s.totals.tools,1);assert.equal(s.totals.toolErrors,1);assert.equal(s.totals.toolMs,100);assert.equal(s.tools.length,0);});
test('three canonical failures produce evidence without body leakage',()=>{const s=fold(failures());assert.equal(s.findings.length,1);assert.deepEqual(s.findings[0].seqs,[4,6,8]);const wire=JSON.stringify(viewOf(s));assert.ok(!wire.includes('denied'));assert.ok(!wire.includes('signature'));assert.ok(!wire.includes('message-c'));});
test('changing the command does not prove repetition',()=>assert.equal(fold(failures(false)).findings.length,0));
test('successful execution breaks failure streak',()=>{const s=fold(fixture([complete(),call(4,'a'),result(5,'a'),call(6,'b'),result(7,'b',false,'ok'),call(8,'c'),result(9,'c')]));assert.equal(s.findings.length,0);});
test('same parameters with different JSON key order match',()=>{const rows=fixture([complete()]);['{"a":1,"b":2}','{"b":2,"a":1}','{"a":1,"b":2}'].forEach((args,i)=>rows.push(call(4+2*i,`c${i}`,args),result(5+2*i,`c${i}`)));assert.equal(fold(rows).findings.length,1);});
test('different error bodies break failure streak',()=>{const rows=failures();rows[7]=result(7,'c1',true,'other');assert.equal(fold(rows).findings.length,0);});
test('authoritative RC1 error field counts failure without isError',()=>{const s=fold(fixture([complete(),call(4,'c'),result(5,'c',false,'oops',{name:'ToolError',code:'EIO'})]));assert.equal(s.totals.toolErrors,1);});
test('unmatched result never manufactures a call',()=>{const s=fold(fixture([result(3,'orphan')]));assert.equal(s.totals.tools,0);assert.equal(s.totals.toolErrors,0);});
test('long arguments do not become equal through truncation',()=>{const rows=fixture([complete()]);for(let i=0;i<3;i++)rows.push(call(4+2*i,`c${i}`,'x'.repeat(65537)),result(5+2*i,`c${i}`));assert.equal(fold(rows).findings.length,0);});
test('new context invalidates uninterrupted failure claim',()=>{const rows=failures();rows.splice(8,0,event('user/message',7.5,750,{source:{kind:'user'}}));const shifted=rows.map((e,i)=>({...e,seq:i}));assert.equal(fold(shifted).findings.length,0);});
test('canceled request without usage is unknown, not free',()=>{const s=fold(fixture([event('step/end',3,100,{turn:1,step:1})]));assert.equal(s.totals.calls,1);assert.equal(s.totals.reported,0);});
test('actual assistant model source owns attribution',()=>{const s=fold(fixture([complete(3,usage,'b')]));assert.equal(s.models[0].model,'b');});
test('retry without next dispatch has no invented latency sample',()=>{const s=fold(fixture([event('llm/retry',3,100,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,2);assert.equal(s.totals.reported,1);assert.equal(s.totals.timedCalls,1);});
test('fork prefix supplies configuration but not new spending',()=>{const s=fold(fixture([complete()]),initialState({id:'fork'},4));assert.equal(s.totals.calls,0);assert.equal(s.route.model,'a');});
test('malformed total is rejected',()=>assert.equal(fold(fixture([complete(3,{...usage,totalTokens:1})])).totals.reported,0));
test('malformed final usage does not fall back to stale interim report',()=>{const s=fold(fixture([event('assistant/chunk',3,20,{turn:1,step:1,chunk:{type:'usage',usage}}),complete(4,{...usage,totalTokens:1})]));assert.equal(s.totals.reported,0);});
test('cache is disjoint input; reasoning not added to total',()=>{const s=fold(fixture([complete()]));assert.equal(s.totals.input,10);assert.equal(s.totals.cacheRead,20);assert.equal(s.totals.tokens,35);});
test('optional missing counters remain without invented exact total',()=>{const s=fold(fixture([complete(3,{inputTokens:3,outputTokens:2})]));assert.equal(s.totals.tokens,5);assert.equal(s.totals.exactTotals,0);assert.equal(s.totals.reasoningReports,0);});
test('unrelated events preserve state reference',()=>{const s=initialState();assert.equal(reduceEvent(s,event('other',1,1)),s);});
test('negative coordinates do not corrupt the projection',()=>{const s=initialState();assert.equal(reduceEvent(s,event('step/start',1,1,{turn:-1,step:1})),s);});
test('silence is suppressed while waiting for user or not running',()=>{const v=viewOf(fold(fixture()));assert.equal(alertsOf(v,90000,{running:false}).length,0);assert.equal(alertsOf(v,90000,{running:true,waiting:true}).length,0);assert.equal(alertsOf(v,90000,{running:true})[0].kind,'silence');});
test('sampled reasoning does not keep growing during silence',()=>{const s=fold(fixture([event('assistant/chunk',3,1000,{turn:1,step:1,chunk:{type:'reasoning-delta',text:'a'}}),event('assistant/chunk',4,1500,{turn:1,step:1,chunk:{type:'reasoning-delta',text:'b'}})]));assert.ok(alertsOf(viewOf(s),999999,{running:true}).every(a=>a.kind!=='reasoning-span'));});
test('invalid thresholds fall back',()=>assert.deepEqual(limitsOf({silenceSeconds:NaN,reasoningSeconds:-1}),{silenceSeconds:30,reasoningSeconds:90}));
test('same model through different providers is not merged',()=>{const v=viewOf(fold(fixture([complete()])));assert.equal(mergeModels([v,v])[0].tokens,70);assert.equal(mergeModels([v,{models:[{...v.models[0],provider:'other'}]}]).length,2);});
test('settings scan never calls follow or other activating operations',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'s',updatedAt:1_700_000_000_000,projections:{values:{watcherInsights:viewOf(fold(fixture([complete()])))}}},{sessionId:'missing'}]}),follow:()=>{throw Error('MUST NOT FOLLOW')}}};const r=await scanSessions(remote);assert.equal(r.rows.filter(x=>x.value).length,1);assert.equal(r.rows.filter(x=>x.error).length,1);assert.equal(r.rows[0].updatedAt,1_700_000_000_000);});
test('cached foreign session identity is rejected',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'other',projections:{values:{watcherInsights:viewOf(initialState({id:'s'}))}}}]})}};assert.equal((await scanSessions(remote)).rows[0].value,null);});
test('direct subagents are explicitly excluded',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'sub',origin:'subagent'}]})}};assert.match((await scanSessions(remote)).rows[0].error,/子代理/);});
test('snapshot delta is coalesced, settlement publishes immediately',()=>{const s=fold(fixture());const n=reduceEvent(s,event('assistant/chunk',3,200,{turn:1,step:1,chunk:{type:'text-delta',text:'x'}}));assert.equal(viewOf(n),viewOf(s));assert.equal(viewOf(reduceEvent(n,complete(4))).totals.reported,1);});
test('checkpoint restore matches uninterrupted state',()=>{const s=fold(fixture());assert.deepEqual(viewOf(reduceEvent(JSON.parse(JSON.stringify(s)),complete())),viewOf(reduceEvent(s,complete())));});
// 0.1.5-rc.1 embeds the compacted attempt stream in the settled message event.
const streamed = (seq, time, records, report = usage) => event('assistant/message', seq, time, {
  turn: 1, step: 1, usage: report, stream: records,
  message: { source: { kind: 'model', provider: 'p', model: 'a' }, role: 'assistant', content: [] },
});
test('a settled 0.1.5 stream supplies first-response and reasoning-span evidence', () => {
  const s = fold(fixture([streamed(3, 9_000, [
    { type: 'reasoning-chunks', time0: 3_000, index: 0, dt: [1_000], texts: ['think ', 'hard'] },
    { type: 'text-chunks', time0: 6_000, index: 1, dt: [], texts: ['done'] },
  ])]));
  assert.equal(s.totals.calls, 1);
  assert.equal(s.totals.firstSamples, 1);
  assert.equal(s.totals.firstMs, 2_990);   // step start 10 → first reasoning 3_000
  assert.equal(s.totals.reasoningMs, 1_000);
  assert.equal(s.totals.tokens, 35);
});
test('a raw usage record inside the durable stream is charged once', () => {
  const s = fold(fixture([streamed(3, 9_000, [{ type: 'chunk', time: 3_000, chunk: { type: 'usage', usage } }], undefined)]));
  assert.equal(s.totals.reported, 1);
  assert.equal(s.totals.tokens, 35);
});
test('a failed attempt keeps its own timing before the retry closes it', () => {
  const s = fold(fixture([
    event('assistant/attempt', 3, 4_000, { turn: 1, step: 1, stream: [{ type: 'reasoning-chunks', time0: 3_000, index: 0, dt: [], texts: ['try'] }] }),
    event('llm/retry', 4, 5_000, { turn: 1, step: 1, retry: 1, delayMs: 500 }),
    streamed(5, 9_000, [{ type: 'reasoning-chunks', time0: 7_000, index: 0, dt: [], texts: ['again'] }]),
  ]));
  assert.equal(s.totals.calls, 2);
  assert.equal(s.totals.retries, 1);
  // A retried attempt has no authoritative start, so only the first attempt's
  // response wait is sampled; the reasoning spans it does prove are one point each.
  assert.equal(s.totals.firstSamples, 1);
  assert.equal(s.totals.firstMs, 2_990);
  assert.equal(s.totals.modelMs, 4_990);
  assert.equal(s.totals.reasoningMs, 0);
});
test('a malformed durable stream never fabricates timing', () => {
  const s = fold(fixture([streamed(3, 9_000, [
    { type: 'reasoning-chunks', time0: 3_000, index: 0, dt: [1_000, 2_000], texts: ['a', 'b'] },
    { type: 'text-chunks', time0: 'soon', index: 1, dt: [], texts: ['done'] },
    { type: 'chunk', time: 6_000, chunk: { type: 'reasoning-delta', index: 0, text: 'late' } },
  ])]));
  assert.equal(s.totals.reasoningMs, 0);
  // The skipped run proves nothing; the raw record that follows still does.
  assert.equal(s.totals.firstMs, 5_990);
});
