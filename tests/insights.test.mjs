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
test('usage chunk and final message are charged once despite replay',()=>{const s=fold(fixture([event('assistant/attempt',3,20,{turn:1,step:1,stream:[{type:'chunk',time:20,chunk:{type:'usage',usage}}]}),complete(4),event('step/end',5,120,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,1);assert.equal(s.totals.tokens,35);assert.equal(s.totals.reasoning,3);assert.equal(s.days.length,1);assert.equal(s.days[0].tokens,35);});
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
test('official Host order copies request/header into the open turn route',()=>{
  const afterStart=fold([event('turn/start',1,1,{turn:1})]);
  assert.deepEqual(afterStart.turn.route,{provider:'unknown',model:'unknown'});
  const afterStep=reduceEvent(afterStart,event('step/start',2,10,{turn:1,step:1}));
  assert.deepEqual(afterStep.turn.route,{provider:'unknown',model:'unknown'});
  const afterHeader=reduceEvent(afterStep,event('request/header',3,20,{header:{config:{provider:'official',model:'real-model'}}}));
  assert.deepEqual(afterHeader.turn.route,{provider:'official',model:'real-model'});
  assert.deepEqual(afterHeader.open.route,{provider:'official',model:'real-model'});
  assert.deepEqual(viewOf(afterHeader).turn.route,{provider:'official',model:'real-model'});
  const settled=reduceEvent(afterHeader,complete(4,usage,'real-model'));
  assert.equal(settled.turn.route.model,'real-model');
  assert.equal(settled.models[0].model,'real-model');
  assert.notEqual(settled.turn.route.model,'unknown');
});
test('official Host order later-turn header change updates the new turn tag',()=>{
  const first=fold([
    event('turn/start',1,1,{turn:1}),
    event('step/start',2,10,{turn:1,step:1}),
    event('request/header',3,20,{header:{config:{provider:'p',model:'m1'}}}),
    complete(4,usage,'m1'),
    event('turn/end',5,110,{turn:1}),
  ]);
  assert.equal(first.turn.route.model,'m1');
  const second=fold([
    event('turn/start',6,200,{turn:2}),
    event('step/start',7,210,{turn:2,step:1}),
    event('request/header',8,220,{header:{config:{provider:'p',model:'m2'}}}),
  ], first);
  assert.equal(second.turn.route.model,'m2');
  assert.deepEqual(viewOf(second).turn.route,{provider:'p',model:'m2'});
});
test('retry without next dispatch has no invented latency sample',()=>{const s=fold(fixture([event('llm/retry',3,100,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,2);assert.equal(s.totals.reported,1);assert.equal(s.totals.timedCalls,1);});
test('fork prefix supplies configuration but not new spending',()=>{const s=fold(fixture([complete()]),initialState({id:'fork'},4));assert.equal(s.totals.calls,0);assert.equal(s.route.model,'a');});
test('malformed total is rejected',()=>assert.equal(fold(fixture([complete(3,{...usage,totalTokens:1})])).totals.reported,0));
test('malformed final usage does not fall back to stale interim report',()=>{const s=fold(fixture([event('assistant/attempt',3,20,{turn:1,step:1,stream:[{type:'chunk',time:20,chunk:{type:'usage',usage}}]}),complete(4,{...usage,totalTokens:1})]));assert.equal(s.totals.reported,0);});
test('cache is disjoint input; reasoning not added to total',()=>{const s=fold(fixture([complete()]));assert.equal(s.totals.input,10);assert.equal(s.totals.cacheRead,20);assert.equal(s.totals.tokens,35);});
test('optional missing counters remain without invented exact total',()=>{const s=fold(fixture([complete(3,{inputTokens:3,outputTokens:2})]));assert.equal(s.totals.tokens,5);assert.equal(s.totals.exactTotals,0);assert.equal(s.totals.reasoningReports,0);});
test('unrelated events preserve state reference',()=>{const s=initialState();assert.equal(reduceEvent(s,event('other',1,1)),s);});
test('negative coordinates do not corrupt the projection',()=>{const s=initialState();assert.equal(reduceEvent(s,event('step/start',1,1,{turn:-1,step:1})),s);});
test('silence is suppressed while waiting for user or not running',()=>{const v=viewOf(fold(fixture()));assert.equal(alertsOf(v,90000,{running:false}).length,0);assert.equal(alertsOf(v,90000,{running:true,waiting:true}).length,0);assert.equal(alertsOf(v,90000,{running:true})[0].kind,'silence');});
test('sampled reasoning does not keep growing during silence',()=>{const s=fold(fixture([event('assistant/attempt',3,1500,{turn:1,step:1,stream:[{type:'reasoning-chunks',time0:1000,index:0,dt:[500],texts:['a','b']}]})]));assert.ok(alertsOf(viewOf(s),999999,{running:true}).every(a=>a.kind!=='reasoning-span'));});
test('invalid thresholds fall back',()=>assert.deepEqual(limitsOf({silenceSeconds:NaN,reasoningSeconds:-1}),{silenceSeconds:30,reasoningSeconds:90}));
test('same model through different providers is not merged',()=>{const v=viewOf(fold(fixture([complete()])));assert.equal(mergeModels([v,v])[0].tokens,70);assert.equal(mergeModels([v,{models:[{...v.models[0],provider:'other'}]}]).length,2);});
test('settings scan never calls follow or other activating operations',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'s',updatedAt:1_700_000_000_000,projections:{values:{watcherInsights:viewOf(fold(fixture([complete()])))}}},{sessionId:'missing'}]}),follow:()=>{throw Error('MUST NOT FOLLOW')}}};const r=await scanSessions(remote);assert.equal(r.rows.filter(x=>x.value).length,1);assert.equal(r.rows.filter(x=>x.error).length,1);assert.equal(r.rows[0].updatedAt,1_700_000_000_000);});
test('cached foreign session identity is rejected',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'other',projections:{values:{watcherInsights:viewOf(initialState({id:'s'}))}}}]})}};assert.equal((await scanSessions(remote)).rows[0].value,null);});
test('direct subagents are explicitly excluded',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'sub',origin:'subagent'}]})}};assert.match((await scanSessions(remote)).rows[0].error,/子代理/);});
test('durable attempt stream updates pending, settlement publishes immediately',()=>{const s=fold(fixture());const n=reduceEvent(s,event('assistant/attempt',3,200,{turn:1,step:1,stream:[{type:'text-chunks',time0:200,index:0,dt:[],texts:['x']}]}));assert.equal(viewOf(n).pending.lastContentAt,200);assert.equal(viewOf(reduceEvent(n,complete(4))).totals.reported,1);});
test('checkpoint restore matches uninterrupted state',()=>{const s=fold(fixture());assert.deepEqual(viewOf(reduceEvent(JSON.parse(JSON.stringify(s)),complete())),viewOf(reduceEvent(s,complete())));});
// Local calendar day key, identical to the engine's creditDay() and the client dayKey():
// never UTC, so expectations hold in any timezone.
const localDayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const settleAt = (seq, time, turnNo = 1, stepNo = 1, model = 'a') => [
  event('turn/start', seq, time, { turn: turnNo }),
  event('step/start', seq + 1, time + 1, { turn: turnNo, step: stepNo }),
  event('assistant/message', seq + 2, time + 2, { turn: turnNo, step: stepNo, usage, message: { source: { kind: 'model', provider: 'p', model }, role: 'assistant', content: [] } }),
  event('turn/end', seq + 3, time + 3, { turn: turnNo }),
];
test('viewOf publishes per-day usage alongside totals',()=>{const s=fold(fixture([complete()]));assert.ok(Array.isArray(s.days));assert.deepEqual(viewOf(s).days,s.days);assert.equal(viewOf(s).version,3);});
test('surface attributes system, memory, conversation and tool prices',()=>{
  const s=fold([
    event('request/header',0,0,{header:{config:{provider:'p',model:'a'},tools:[{name:'bash'}]}}),
    event('system/message',1,1,{turn:1,step:1,message:{role:'system',content:[{type:'text',text:'you are helpful'.repeat(40)}]}}),
    event('turn/start',2,2,{turn:1}),
    event('user/message',3,3,{turn:1,step:1,message:{role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'}]}}),
    event('user/message',4,4,{turn:1,step:1,message:{role:'user',source:{kind:'agent.inject',form:'instructions'},content:[{type:'text',text:'AGENTS.md'.repeat(60)}]}}),
    event('step/start',5,10,{turn:1,step:1}),
    complete(6),
  ]);
  const v=viewOf(s);
  assert.ok(v.context.surface.system>0);
  assert.ok(v.context.surface.memory>0);
  assert.ok(v.context.surface.conversation>0);
  assert.ok(v.context.surface.tools>0);
  assert.equal(v.context.surface.files,0);
  assert.equal(v.context.surface.total,v.context.projected);
  assert.equal(v.context.surface.partial,false);
});
test('file attachment user messages price into the files bucket',()=>{
  const s=fold(fixture([
    event('user/message',3,3,{turn:1,step:1,message:{role:'user',source:{kind:'user'},content:[{type:'file',attachment:{path:'a.ts',text:'x'.repeat(400)}}]}}),
    complete(4),
  ]));
  assert.ok(viewOf(s).context.surface.files>0);
  assert.equal(viewOf(s).context.surface.conversation,0);
});
test('surface replacement removes shadowed nodes from buckets',()=>{
  const rows=[
    event('turn/start',1,1,{turn:1}),
    event('user/message',2,2,{turn:1,step:1,message:{role:'user',source:{kind:'user'},content:[{type:'text',text:'x'.repeat(400)}]}}),
    event('step/start',3,10,{turn:1,step:1}),
    {type:'assistant/message',seq:4,time:100,surfaceOp:{op:'replace',startSeq:2,endSeq:2},data:{turn:1,step:1,usage,message:{source:{kind:'model',provider:'p',model:'a'},role:'assistant',content:[{type:'text',text:'done'}]}}},
  ];
  const v=viewOf(fold(rows));
  const done=Math.ceil(JSON.stringify([{type:'text',text:'done'}]).length/4)+4;
  assert.equal(v.context.surface.conversation,done);
  // The settled request still prices the prompt as dispatched: its own
  // replace+append lands in the NEXT request's delta, not this row's surface.
  assert.equal(v.requests[0].surface.conversation,Math.ceil(JSON.stringify([{type:'text',text:'x'.repeat(400)}]).length/4)+4);
});
test('settled requests are recorded with usage and timing',()=>{
  const s=fold(fixture([complete(3)]));
  const v=viewOf(s);
  assert.equal(v.requests.length,1);
  const r=v.requests[0];
  assert.deepEqual({turn:r.turn,step:r.step}, {turn:1,step:1});
  assert.equal(r.usage.tokens,35);
  assert.equal(r.usage.cacheRead,20);
  assert.equal(r.modelMs,90);
  assert.ok(r.surface.total>=0);
});
test('request/context publishes the advertised window',()=>{
  const s=fold([event('request/context',0,0,{provider:'p',model:'a',contextWindow:200000})]);
  assert.equal(viewOf(s).context.window,200000);
});
test('skipped surface events mark the estimate partial',()=>{
  const s=fold([event('user/message',2,2,{turn:1,step:1,message:{role:'user',source:{kind:'user'},content:[{type:'text',text:'x'}]}})],initialState({id:'fork'},4));
  assert.equal(viewOf(s).context.surface.partial,true);
  assert.equal(viewOf(s).context.surface.conversation,0);
});
test('two settlements 36 hours apart land on two distinct local days',()=>{
  const hour = 3600000;
  const t1 = 0;
  const t2 = t1 + 36 * hour; // 36h apart always crosses local midnight, whatever the offset
  const s = fold(fixture([...settleAt(3, t1, 1, 1, 'a'), ...settleAt(7, t2, 2, 1, 'b')]));
  assert.equal(s.totals.reported, 2);
  assert.deepEqual(s.days.map(d => d.key), [localDayKey(t1), localDayKey(t2)].sort());
  assert.deepEqual(s.days.map(d => d.tokens), [35, 35]);
  assert.deepEqual(s.days.map(d => d.models.map(m => m.model)), [['a'], ['b']]);
  assert.equal(s.days.reduce((sum, d) => sum + d.tokens, 0), s.totals.tokens);
});
test('two settlements on the same local day merge into one day entry',()=>{
  const hour = 3600000;
  const t1 = 0;
  const t2 = t1 + hour; // one hour apart: same local day for every real offset
  const s = fold(fixture([...settleAt(3, t1, 1, 1, 'a'), ...settleAt(7, t2, 2, 1, 'a')]));
  assert.equal(s.totals.reported, 2);
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].key, localDayKey(t1));
  assert.equal(s.days[0].tokens, 70);
  assert.equal(s.days[0].models.length, 1);
  assert.equal(s.days[0].models[0].tokens, 70);
  assert.equal(s.days[0].tokens, s.totals.tokens);
});
test('settlements without usage never manufacture a day',()=>{const s=fold(fixture());assert.deepEqual(s.days,[]);});
test('effort changes split the same model into separate day model rows',()=>{
  const rows = [
    event('request/header', 0, 0, { header: { config: { provider: 'p', model: 'a', reasoningEffort: 'high' } } }),
    ...settleAt(1, 3600000, 1, 1, 'a'),
    event('request/header', 5, 7200000, { header: { config: { provider: 'p', model: 'a', reasoningEffort: 'low' } } }),
    ...settleAt(6, 10800000, 2, 1, 'a'),
  ];
  const s = fold(rows);
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].models.length, 2);
  assert.deepEqual(s.days[0].models.map(m => m.effort).sort(), ['high', 'low']);
  assert.equal(s.days[0].tokens, 70);
});
test('day books survive checkpoint restore without double counting',()=>{const s=fold(fixture([complete()]));const restored=reduceEvent(JSON.parse(JSON.stringify(s)),complete());assert.equal(restored.days.length,1);assert.equal(restored.days[0].tokens,35);assert.deepEqual(viewOf(restored).days,viewOf(s).days);});
test('settings scan accepts version 2 caches with days',async()=>{const v2=viewOf(fold(fixture([complete()])));const remote={session:{list:async()=>({items:[{sessionId:'s',projections:{values:{watcherInsights:v2}}}]})}};const r=await scanSessions(remote);assert.equal(r.rows[0].value,v2);assert.equal(r.rows[0].error,null);});
test('version 1 cache without days still displays via the updatedAt fallback',async()=>{
  const v1={...viewOf(fold(fixture([complete()]))),version:1};delete v1.days;
  const remote={session:{list:async()=>({items:[{sessionId:'s',updatedAt:1234,projections:{values:{watcherInsights:v1}}}]})}};
  const r=await scanSessions(remote);assert.equal(r.rows[0].value,v1);assert.equal(r.rows[0].error,null);
});
