/** Read-only DSH 0.1.5-rc.2 log fold. No prompt, reasoning or tool body is retained. */
import { createHash } from 'node:crypto';
export const KEY = 'watcherInsights';
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const elapsed = (start, end) => start === null ? 0 : Math.max(0, end - start);
export function emptyStats() {
  return { calls: 0, reported: 0, exactTotals: 0, tokens: 0, input: 0, output: 0,
    cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningReports: 0,
    modelMs: 0, timedCalls: 0, firstMs: 0, firstSamples: 0, reasoningMs: 0,
    tools: 0, toolErrors: 0, toolMs: 0, bashMs: 0, retries: 0 };
}
export function initialState(header = {}, inherited = 0) {
  const s = { version: 1, sessionId: String(header.id ?? ''), skip: inherited, seq: -1,
    updatedAt: 0, route: { provider: 'unknown', model: 'unknown' }, totals: emptyStats(),
    models: [], turn: null, open: null, tools: [], previousFailure: null,
    findings: [], findingCount: 0 };
  s.wire = buildView(s);
  return s;
}
function normalizeUsage(value) {
  if (!record(value) || !count(value.inputTokens) || !count(value.outputTokens)) return null;
  const optional = ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
  if (optional.some(k => value[k] !== undefined && !count(value[k]))) return null;
  const minimum = value.inputTokens + value.outputTokens + (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0);
  if (!Number.isSafeInteger(minimum) || (value.totalTokens !== undefined && value.totalTokens < minimum)) return null;
  return { input: value.inputTokens, output: value.outputTokens, cacheRead: value.cacheReadTokens ?? 0,
    cacheWrite: value.cacheWriteTokens ?? 0, reasoning: value.reasoningTokens ?? null,
    tokens: value.totalTokens ?? minimum, exact: value.totalTokens !== undefined };
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (record(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
function fingerprint(v) {
  try {
    let text = typeof v === 'string' ? v : JSON.stringify(v);
    if (!text || text.length > 65536) return null;
    try { text = JSON.stringify(canonical(JSON.parse(text))); } catch {}
    return createHash('sha256').update(text).digest('hex');
  } catch { return null; }
}
function signatureOf(name, args) {
  const hash = fingerprint(args);
  return hash === null ? null : fingerprint([name, hash]);
}
function modelRow(s, route) {
  const effort = typeof route?.effort === 'string' ? route.effort : null;
  let row = s.models.find(m => m.provider === route.provider && m.model === route.model && (m.effort ?? null) === effort);
  if (!row) {
    row = { provider: route.provider, model: route.model, ...(effort ? { effort } : {}), ...emptyStats() };
    s.models.push(row);
  }
  return row;
}
function books(s, route = s.route) { return [s.totals, modelRow(s, route), ...(s.turn ? [s.turn.stats] : [])]; }
function begin(s, d, time, uncertain = false) {
  s.open = { turn: d.turn, step: d.step, start: uncertain ? null : time, first: null,
    reasoningFirst: null, reasoningLast: null, lastContentAt: null, usage: null, route: { ...s.route } };
}
function settle(s, time, usage, source) {
  const a = s.open;
  if (!a) return;
  const route = record(source) && typeof source.provider === 'string' && typeof source.model === 'string'
    ? { provider: source.provider, model: source.model, ...(a.route?.effort ? { effort: a.route.effort } : {}) } : a.route;
  s.route = route;
  const u = usage === undefined || usage === null ? a.usage : normalizeUsage(usage);
  for (const b of books(s, route)) {
    b.calls++;
    if (a.start !== null) { b.timedCalls++; b.modelMs += elapsed(a.start, time); }
    if (a.start !== null && a.first !== null) { b.firstSamples++; b.firstMs += elapsed(a.start, a.first); }
    if (a.reasoningFirst !== null && a.reasoningLast !== null) b.reasoningMs += elapsed(a.reasoningFirst, a.reasoningLast);
    if (u) {
      b.reported++; b.exactTotals += Number(u.exact); b.tokens += u.tokens;
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) b[k] += u[k];
      if (u.reasoning !== null) { b.reasoningReports++; b.reasoning += u.reasoning; }
    }
  }
  s.open = null;
}
function applyChunk(open, chunk, time) {
  if (!record(chunk) || typeof chunk.type !== 'string') return;
  if (chunk.type === 'usage') {
    open.usage = normalizeUsage(chunk.usage);
    return;
  }
  if (!['reasoning-delta', 'text-delta', 'tool-call-delta'].includes(chunk.type)) return;
  if (!(typeof chunk.text === 'string' && chunk.text.length) && !(typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta.length) && !chunk.name) return;
  open.first ??= time; open.lastContentAt = time;
  if (chunk.type === 'reasoning-delta') { open.reasoningFirst ??= time; open.reasoningLast = time; }
}
function applyStream(open, stream) {
  if (!open || !Array.isArray(stream)) return;
  for (const rec of stream) {
    if (!record(rec) || typeof rec.type !== 'string') continue;
    if (rec.type === 'chunk') {
      applyChunk(open, rec.chunk, rec.time);
      continue;
    }
    const parts = rec.type === 'tool-call-chunks' ? rec.args : rec.texts;
    const gaps = rec.dt;
    if (!Array.isArray(parts) || !parts.length || !parts.every(p => typeof p === 'string')
      || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger)
      || !Number.isSafeInteger(rec.time0)) continue;
    let time = rec.time0;
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) time += gaps[i - 1];
      if (rec.type === 'reasoning-chunks') applyChunk(open, { type: 'reasoning-delta', text: parts[i] }, time);
      else if (rec.type === 'text-chunks') applyChunk(open, { type: 'text-delta', text: parts[i] }, time);
      else if (rec.type === 'tool-call-chunks') applyChunk(open, { type: 'tool-call-delta', argumentsDelta: parts[i], name: rec.name }, time);
    }
  }
}
const interesting = new Set(['request/header', 'user/message', 'turn/start', 'step/start', 'assistant/attempt', 'assistant/message', 'llm/retry', 'tool/call', 'tool/result', 'step/end', 'turn/end']);
export function reduceEvent(state, event) {
  if (!record(event) || !interesting.has(event.type) || !count(event.seq) || !Number.isFinite(event.time) || !record(event.data)) return state;
  if (event.seq <= state.seq) return state;
  const d = event.data;
  if (event.seq < state.skip && event.type !== 'request/header') return state;
  if (event.type === 'user/message' && !state.previousFailure) return state;
  if (!['request/header', 'user/message'].includes(event.type) && !count(d.turn)) return state;
  if (!['request/header', 'user/message', 'turn/start', 'turn/end'].includes(event.type) && !count(d.step)) return state;
  if ((event.type === 'assistant/attempt' || event.type === 'assistant/message') && d.stream !== undefined && !Array.isArray(d.stream)) return state;
  if (event.type === 'assistant/attempt' && (!state.open || state.open.turn !== d.turn || state.open.step !== d.step)) return state;
  const s = structuredClone(state);
  s.wire = state.wire;
  s.seq = event.seq; s.updatedAt = event.time;
  if (event.type === 'request/header') {
    const config = d.header?.config;
    if (typeof config?.provider === 'string' && typeof config.model === 'string') {
      const effort = typeof config.reasoningEffort === 'string' ? config.reasoningEffort : null;
      s.route = { provider: config.provider, model: config.model, ...(effort ? { effort } : {}) };
      if (s.open) s.open.route = { ...s.route };
    }
  } else if (event.type === 'user/message') {
    s.previousFailure = null;
  } else if (event.type === 'turn/start') {
    if (s.open) settle(s, event.time, null, null);
    s.turn = { number: d.turn, startedAt: event.time, endedAt: null, steps: 0, stats: emptyStats(), route: { ...s.route } };
    s.previousFailure = null; s.tools = [];
  } else if (event.type === 'step/start') {
    if (s.open) settle(s, event.time, null, null);
    begin(s, d, event.time);
    if (s.turn) s.turn.steps++;
  } else if (event.type === 'assistant/attempt') {
    applyStream(s.open, d.stream);
  } else if (event.type === 'assistant/message') {
    if (s.open?.turn === d.turn && s.open.step === d.step) {
      applyStream(s.open, d.stream);
      settle(s, event.time, d.usage, d.message?.source);
    }
  } else if (event.type === 'llm/retry') {
    if (s.open?.turn === d.turn && s.open.step === d.step) {
      settle(s, event.time, null, null);
      for (const b of books(s)) b.retries++;
      begin(s, d, event.time, true);
    }
  } else if (event.type === 'tool/call') {
    const id = d.callId, name = d.name;
    if (typeof id === 'string' && typeof name === 'string' && !s.tools.some(t => t.id === id)) {
      s.tools.push({ id, name, start: event.time, seq: event.seq, step: d.step,
        route: { ...s.route }, signature: signatureOf(name, d.arguments) });
      for (const b of books(s)) b.tools++;
    }
  } else if (event.type === 'tool/result') {
    // RC1 stores a ToolResultMessage, not top-level callId/result fields.
    const block = d.message?.content?.find?.(b => b?.type === 'tool-result');
    const id = block?.toolCallId ?? d.message?.source?.callId;
    const index = s.tools.findIndex(t => t.id === id);
    if (index >= 0) {
      const t = s.tools.splice(index, 1)[0];
      const failed = block?.isError === true || record(d.error);
      const dur = elapsed(t.start, event.time);
      for (const b of books(s, t.route)) { b.toolMs += dur; b.toolErrors += Number(failed); if (t.name === 'bash') b.bashMs = (b.bashMs ?? 0) + dur; }
      const resultHash = block ? fingerprint({ content: block.content, isError: failed, code: d.error?.code ?? null }) : null;
      const prev = s.previousFailure;
      if (failed && t.signature && resultHash) {
        const same = prev?.signature === t.signature && prev?.resultHash === resultHash && prev?.turn === d.turn;
        const failure = { signature: t.signature, resultHash, turn: d.turn,
          seqs: [...(same ? prev.seqs : []), t.seq].slice(-10), steps: [...(same ? prev.steps : []), t.step].slice(-10) };
        s.previousFailure = failure;
        if (failure.seqs.length >= 3) {
          const id = `repeat:${d.turn}:${failure.seqs[0]}`;
          const finding = { id, kind: 'repeated-failure', turn: d.turn, seqs: failure.seqs, steps: failure.steps,
            title: `同一操作连续失败 ${failure.seqs.length} 次`,
            detail: '参数与错误结果指纹相同；这是重复失败证据，不是确定的空转或质量判决。' };
          const old = s.findings.findIndex(f => f.id === id);
          if (old >= 0) s.findings[old] = finding;
          else { s.findingCount++; s.findings.push(finding); s.findings = s.findings.slice(-30); }
        }
      } else s.previousFailure = null;
    }
  } else if (event.type === 'step/end') {
    if (s.open?.turn === d.turn && s.open.step === d.step) settle(s, event.time, null, null);
  } else if (event.type === 'turn/end') {
    if (s.open) settle(s, event.time, null, null);
    if (s.turn) s.turn.endedAt = event.time;
    s.tools = []; s.previousFailure = null;
  }
  s.wire = buildView(s);
  return s;
}
function buildView(s) {
  return { version: s.version, sessionId: s.sessionId, seq: s.seq, updatedAt: s.updatedAt,
    totals: s.totals, models: s.models, turn: s.turn,
    pending: s.open ? { turn: s.open.turn, step: s.open.step, start: s.open.start,
      reasoningFirst: s.open.reasoningFirst, reasoningLast: s.open.reasoningLast,
      lastContentAt: s.open.lastContentAt } : null,
    findings: s.findings, findingCount: s.findingCount };
}
export function viewOf(s) { return s.wire; }
