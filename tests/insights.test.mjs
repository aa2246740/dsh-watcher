import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceEvent, viewOf } from '../src/insights/engine.mjs';
import { alertsOf, limitsOf, mergeModels, scanSessions } from '../src/insights/presentation.mjs';
const event = (type, seq, time, data = {}) => ({ type, seq, time, data });
const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, reasoningTokens: 3, totalTokens: 35 };
function fixture(extra = []) { return [event('request/header', 0, 0, { header: { config: { provider: 'p', model: 'a' } } }), event('turn/start', 1, 1, { turn: 1 }), event('step/start', 2, 10, { turn: 1, step: 1 }), ...extra]; }
const fold = (events, state = initialState({ id: 's' })) => events.reduce(reduceEvent, state);
test('usage chunk + message + duplicate delivery charge once; reasoning is not added twice', () => {
  const s = fold(fixture([event('assistant/chunk', 3, 20, { turn: 1, step: 1, chunk: { type: 'usage', usage } }), event('assistant/message', 4, 30, { turn: 1, step: 1, usage }), event('step/end', 5, 31, { turn: 1, step: 1 }), event('assistant/message', 4, 30, { turn: 1, step: 1, usage })]));
  assert.equal(s.totals.calls, 1); assert.equal(s.totals.tokens, 35); assert.equal(s.totals.reasoning, 3);
});
test('cancellation without usage is missing report, not zero-cost success', () => {
  const s = fold(fixture([event('step/end', 3, 100, { turn: 1, step: 1 })])); assert.equal(s.totals.calls, 1); assert.equal(s.totals.reported, 0);
});
test('actual assistant source owns model attribution', () => {
  const s = fold(fixture([event('assistant/message', 3, 100, { turn: 1, step: 1, usage, message: { source: { provider: 'q', model: 'b' } } })])); assert.equal(s.models[0].model, 'b'); assert.equal(s.models[0].provider, 'q');
});
test('retry without request-entry boundary is not a fabricated latency sample', () => {
  const s = fold(fixture([event('llm/retry', 3, 100, { turn: 1, step: 1 }), event('assistant/message', 4, 500, { turn: 1, step: 1, usage })])); assert.equal(s.totals.calls, 2); assert.equal(s.totals.reported, 1); assert.equal(s.totals.timedCalls, 1);
});
test('fork inherited events do not become new spending', () => assert.equal(fold(fixture([event('assistant/message', 3, 100, { turn: 1, step: 1, usage })]), initialState({ id: 'fork' }, 4)).totals.calls, 0));
test('contradictory total is not accepted', () => assert.equal(fold(fixture([event('assistant/message', 3, 100, { turn: 1, step: 1, usage: { ...usage, totalTokens: 1 } })])).totals.reported, 0));
function failures(repeat = true) {
 const rows = fixture([event('assistant/message', 3, 30, { turn: 1, step: 1, usage })]);
 for (let i = 0; i < 3; i++) { rows.push(event('tool/call', 4 + i * 2, 100 + i * 10, { turn: 1, step: 1, call: { id: `c${i}`, name: 'bash', arguments: repeat ? '{"command":"x"}' : JSON.stringify({ command: `x${i}` }) } })); rows.push(event('tool/result', 5 + i * 2, 105 + i * 10, { turn: 1, step: 1, callId: `c${i}`, result: { toolCallId: `c${i}`, isError: true, content: [{ type: 'text', text: 'denied' }] } })); } return rows;
}
test('three identical failed operations produce evidence; wire has no result text or fingerprints', () => { const s = fold(failures()); assert.equal(s.findings.length, 1); assert.deepEqual(s.findings[0].seqs, [4,6,8]); const text = JSON.stringify(viewOf(s)); assert.ok(!text.includes('denied')); assert.ok(!text.includes('signature')); });
test('different commands are not repeated failure', () => assert.equal(fold(failures(false)).findings.length, 0));
test('unrelated events preserve state reference', () => { const s = initialState(); assert.equal(reduceEvent(s, event('other', 1, 1)), s); });
test('silence is suppressed while waiting for user or not running', () => { const v = viewOf(fold(fixture())); assert.equal(alertsOf(v, 90000, { running: false }).length, 0); assert.equal(alertsOf(v, 90000, { running: true, waiting: true }).length, 0); assert.equal(alertsOf(v, 90000, { running: true })[0].kind, 'silence'); });
test('reasoning span does not keep growing during silence', () => {
 const v = viewOf(fold(fixture([event('assistant/chunk', 3, 100, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'a' } }),event('assistant/chunk', 4, 200, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'b' } })]))); assert.ok(alertsOf(v, 999999, { running: true }).every(a => a.kind !== 'reasoning-span'));
});
test('invalid thresholds fall back', () => assert.deepEqual(limitsOf({ silenceSeconds: NaN, reasoningSeconds: -1 }), { silenceSeconds: 30, reasoningSeconds: 90 }));
test('aggregation keeps provider routes separate', () => { const v = viewOf(fold(fixture([event('assistant/message', 3, 50, { turn: 1, step: 1, usage })]))); assert.equal(mergeModels([v,v])[0].tokens,70); assert.equal(mergeModels([v,{models:[{...v.models[0],provider:'other'}]}]).length,2); });
test('settings scan closes followers and reports absent capabilities', async () => { let closed=0; const remote={session:{list:async()=>({items:[{sessionId:'a'},{sessionId:'b'}]}),follow:async function*({address}){try{yield {type:'snapshot',projections:{values:address.sessionId==='a'?{watcherInsights:viewOf(initialState())}:{}}};}finally{closed++;}}}}; const r=await scanSessions(remote); assert.equal(closed,2); assert.equal(r.rows.filter(x=>x.value).length,1); assert.equal(r.rows.filter(x=>x.error).length,1); });
test('delta publication is bounded and final settlement immediate', () => { const s=fold(fixture()); const next=reduceEvent(s,event('assistant/chunk',3,200,{turn:1,step:1,chunk:{type:'text-delta',text:'x'}})); assert.equal(viewOf(next),viewOf(s)); assert.equal(viewOf(reduceEvent(next,event('assistant/message',4,250,{turn:1,step:1,usage}))).totals.reported,1); });
test('checkpoint restore equals original fold', () => { const s=fold(fixture()); const end=event('assistant/message',3,250,{turn:1,step:1,usage}); assert.deepEqual(viewOf(reduceEvent(JSON.parse(JSON.stringify(s)),end)),viewOf(reduceEvent(s,end))); });
