import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceEvent, viewOf } from '../src/insights/engine.mjs';
import { alertsOf, limitsOf, mergeModels, mergeSkills, mergeTools, mergeWorkspaces, scanSessions, workspaceLabel } from '../src/insights/presentation.mjs';
const event = (type, seq, time, data = {}) => ({ type, seq, time, data });
const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, reasoningTokens: 3, totalTokens: 35 };
function fixture(extra = []) { return [event('request/header', 0, 0, { header: { config: { provider: 'p', model: 'a' } } }), event('turn/start', 1, 1, { turn: 1 }), event('step/start', 2, 10, { turn: 1, step: 1 }), ...extra]; }
const fold = (events, state = initialState({ id: 's' })) => events.reduce(reduceEvent, state);
const complete = (seq=3, report=usage, model='a') => event('assistant/message',seq,100,{turn:1,step:1,usage:report,message:{source:{kind:'model',provider:'p',model},role:'assistant',content:[]}});
function call(seq, id, args='{"command":"x"}') { return event('tool/call',seq,seq*100,{turn:1,step:1,callId:id,name:'bash',arguments:args}); }
function result(seq,id,failed=true,content='denied',error) { return event('tool/result',seq,seq*100,{turn:1,step:1,message:{id:`message-${id}`,role:'user',source:{kind:'tool',callId:id},content:[{type:'tool-result',toolCallId:id,isError:failed,content:[{type:'text',text:content}]}]},...(error?{error}:{} )}); }
function failures(repeat=true) { const rows=fixture([complete()]); for(let i=0;i<3;i++) rows.push(call(4+2*i,`c${i}`,repeat?'{"command":"x"}':JSON.stringify({command:`x${i}`})),result(5+2*i,`c${i}`));return rows; }
test('usage chunk and final message are charged once despite replay',()=>{const s=fold(fixture([event('assistant/attempt',3,20,{turn:1,step:1,stream:[{type:'chunk',time:20,chunk:{type:'usage',usage}}]}),complete(4),event('step/end',5,120,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,1);assert.equal(s.totals.tokens,35);assert.equal(s.totals.reasoning,3);});
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
// —— 消耗明细排行新增：toolStats / skillStats / prompts / turns / cwd ——
const userMsg = (seq, text = 'hi') => event('user/message', seq, seq * 100, { source: { kind: 'user' }, content: [{ type: 'text', text }] });
const skillInvoke = (seq, name, text = 'skill body') => event('user/message', seq, seq * 100, { source: { kind: 'skill-invocation', name, form: 'instructions' }, content: [{ type: 'text', text }] });
const skillCall = (seq, id, name) => event('tool/call', seq, seq * 100, { turn: 1, step: 1, callId: id, name: 'skill', arguments: JSON.stringify({ name }) });
const stepEnd = (seq, turn = 1, step = 1) => event('step/end', seq, seq * 100, { turn, step });
const turnEnd = (seq, turn = 1) => event('turn/end', seq, seq * 100, { turn });
test('tool calls record counts, step tokens, duration and result size', () => {
  const s = fold(fixture([complete(3), call(4, 'c'), result(5, 'c', false, 'x'.repeat(50)), stepEnd(6)]));
  const t = s.toolStats.find(x => x.name === 'bash');
  assert.equal(t.calls, 1); assert.equal(t.stepTokens, 35); assert.equal(t.errors, 0);
  assert.equal(t.toolMs, 100); assert.equal(t.resultChars, 50);
  const v = viewOf(s); assert.equal(v.version, 2); assert.equal(v.toolStats[0].name, 'bash');
});
test('calls made before usage settles still get the full step tokens at step end', () => {
  const s = fold(fixture([call(3, 'c'), complete(4), result(5, 'c', false, 'ok'), stepEnd(6)]));
  assert.equal(s.toolStats.find(x => x.name === 'bash').stepTokens, 35);
});
test('each call in a step records the whole step usage without splitting', () => {
  const s = fold(fixture([complete(3), call(4, 'a'), result(5, 'a', false, 'ok'), call(6, 'b'), result(7, 'b', false, 'ok'), stepEnd(8)]));
  assert.equal(s.toolStats[0].stepTokens, 70); assert.equal(s.toolStats[0].calls, 2);
});
test('model skill tool call attributes tokens, duration and injected size', () => {
  const s = fold(fixture([complete(3), skillCall(4, 'c', 'deploy'), result(5, 'c', false, 'x'.repeat(300)), stepEnd(6)]));
  const k = s.skillStats.find(x => x.name === 'deploy');
  assert.equal(k.modelCalls, 1); assert.equal(k.userCalls, 0); assert.equal(k.stepTokens, 35);
  assert.equal(k.toolMs, 100); assert.equal(k.injectedChars, 300); assert.equal(k.lastSeen, 400); assert.equal(k.errors, 0);
  assert.equal(s.toolStats.find(x => x.name === 'skill').calls, 1);
});
test('failed skill call still counts the call and records the error', () => {
  const s = fold(fixture([complete(3), skillCall(4, 'c', 'deploy'), result(5, 'c', true, 'boom'), stepEnd(6)]));
  const k = s.skillStats[0];
  assert.equal(k.modelCalls, 1); assert.equal(k.errors, 1); assert.equal(k.stepTokens, 35);
});
test('manual /skill invocation counts user calls and injected size only', () => {
  const s = fold(fixture([skillInvoke(3, 'review', 'x'.repeat(1000))]));
  const k = s.skillStats[0];
  assert.equal(k.userCalls, 1); assert.equal(k.modelCalls, 0); assert.equal(k.injectedChars, 1000); assert.equal(k.stepTokens, 0);
});
test('unparseable skill arguments do not invent a skill name', () => {
  const s = fold(fixture([event('tool/call', 3, 300, { turn: 1, step: 1, callId: 'c', name: 'skill', arguments: '{broken' }), stepEnd(4)]));
  assert.equal(s.skillStats.length, 0);
  assert.equal(s.toolStats.find(x => x.name === 'skill').calls, 1);
});
test('real prompts are counted, catalogs and other sources are not', () => {
  const s = fold(fixture([userMsg(3), skillInvoke(4, 'deploy'), event('user/message', 5, 500, { source: { kind: 'skill-catalog' } })]));
  assert.equal(s.prompts, 1); assert.equal(s.skillStats.length, 1);
});
test('turn log records start, tokens and tool count and caps at 500', () => {
  const events = [];
  for (let i = 1; i <= 505; i++) events.push(event('turn/start', 2 * i - 1, i * 100, { turn: i }), event('turn/end', 2 * i, i * 100 + 50, { turn: i }));
  const s = fold(events);
  assert.equal(s.turns.length, 500); assert.equal(s.turns[0].n, 6); assert.equal(s.turns.at(-1).n, 505);
});
test('turn row carries timing, tokens, tool and call counts', () => {
  const s = fold(fixture([complete(3), call(4, 'c'), result(5, 'c', false, 'ok'), stepEnd(6), turnEnd(7)]));
  const t = s.turns[0];
  assert.equal(t.n, 1); assert.equal(t.start, 1); assert.equal(t.end, 700);
  assert.equal(t.tokens, 35); assert.equal(t.tools, 1); assert.equal(t.calls, 1);
});
test('cwd and preset come from the session header', () => {
  const v = viewOf(reduceEvent(initialState({ id: 's', cwd: '/Users/x/proj', agentPreset: 'coder' }), event('turn/start', 1, 1, { turn: 1 })));
  assert.equal(v.cwd, '/Users/x/proj'); assert.equal(v.preset, 'coder');
});
test('private step bookkeeping never reaches the wire view', () => {
  const v = viewOf(fold(fixture([complete(3), call(4, 'c'), result(5, 'c', false, 'ok')])));
  assert.equal(v.stepCalls, undefined); assert.equal(v.stepTokens, undefined);
});
test('mergeTools aggregates calls and step tokens across sessions', () => {
  const v1 = viewOf(fold(fixture([complete(3), call(4, 'a'), result(5, 'a', false, 'ok'), stepEnd(6)]), initialState({ id: 's1' })));
  const v2 = viewOf(fold(fixture([complete(3), call(4, 'a'), result(5, 'a', true, 'x'), stepEnd(6)]), initialState({ id: 's2' })));
  const rows = mergeTools([v1, v2]);
  assert.equal(rows[0].name, 'bash'); assert.equal(rows[0].calls, 2); assert.equal(rows[0].stepTokens, 70);
  assert.equal(rows[0].errors, 1); assert.equal(rows[0].sessions, 2);
});
test('mergeSkills separates model and user invocations', () => {
  const v = viewOf(fold(fixture([complete(3), skillCall(4, 'c', 'deploy'), result(5, 'c', false, 'ok'), stepEnd(6), skillInvoke(7, 'deploy', 'x'.repeat(40))])));
  const rows = mergeSkills([v]);
  assert.equal(rows[0].name, 'deploy'); assert.equal(rows[0].modelCalls, 1);
  assert.equal(rows[0].userCalls, 1); assert.equal(rows[0].injectedChars, 42); assert.equal(rows[0].stepTokens, 35);
});
test('mergeWorkspaces groups by cwd with basename label and model rows', () => {
  const mk = (id, cwd) => viewOf(fold(fixture([complete(3)]), initialState({ id, cwd })));
  const rows = [
    { sessionId: 'a', cwd: '/home/x/alpha', value: mk('a', '/home/x/alpha') },
    { sessionId: 'b', cwd: '/home/x/alpha', value: mk('b', '/home/x/alpha') },
    { sessionId: 'c', cwd: null, value: mk('c', '/home/x/beta') },
  ];
  const ws = mergeWorkspaces(rows);
  assert.equal(ws.length, 2);
  assert.equal(ws[0].label, 'alpha'); assert.equal(ws[0].sessions, 2); assert.equal(ws[0].tokens, 70); assert.equal(ws[0].modelRows[0].model, 'a');
  assert.equal(ws[1].label, 'beta'); assert.equal(ws[1].sessions, 1); assert.equal(ws[1].cwd, '/home/x/beta');
});
test('workspaceLabel takes the basename across separators and falls back', () => {
  assert.equal(workspaceLabel('/a/b/c'), 'c'); assert.equal(workspaceLabel('C:\\x\\y'), 'y');
  assert.equal(workspaceLabel(''), '未记录目录'); assert.equal(workspaceLabel(null), '未记录目录');
});
test('scanSessions rejects legacy v1 projections and passes cwd through', async () => {
  const legacy = viewOf(fold(fixture([complete()]), initialState({ id: 's' }))); legacy.version = 1;
  const remote = { session: { list: async () => ({ items: [
    { sessionId: 's', updatedAt: 1, cwd: '/x/y', projections: { values: { watcherInsights: legacy } } },
    { sessionId: 't', updatedAt: 2, cwd: '/z', projections: { values: { watcherInsights: viewOf(fold(fixture([complete()]), initialState({ id: 't' }))) } } },
  ] }) } };
  const r = await scanSessions(remote);
  const s = r.rows.find(x => x.sessionId === 's'), t = r.rows.find(x => x.sessionId === 't');
  assert.equal(s.value, null); assert.match(s.error, /统计缓存/);
  assert.equal(t.cwd, '/z'); assert.ok(t.value);
});
