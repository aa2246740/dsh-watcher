/** Browser-safe analysis. No agent commands or model calls. */
/** @type {{silenceSeconds:number, reasoningSeconds:number}} */
export const DEFAULT_LIMITS = Object.freeze({ silenceSeconds: 30, reasoningSeconds: 90 });
export function limitsOf(raw) {
  const safe = (v, fallback) => Number.isFinite(v) && v >= 5 && v <= 3600 ? Math.round(v) : fallback;
  return { silenceSeconds: safe(raw?.silenceSeconds, 30), reasoningSeconds: safe(raw?.reasoningSeconds, 90) };
}
/** @param {any} view @param {number} now @param {{running?:boolean,waiting?:boolean,limits?:{silenceSeconds:number,reasoningSeconds:number}}} options */
export function alertsOf(view, now, { running = false, waiting = false, limits = DEFAULT_LIMITS } = {}) {
  if (!view) return [];
  const alerts = (view.findings ?? []).filter(f => f.turn === view.turn?.number).slice(-3);
  const p = view.pending;
  if (!running || waiting || !p) return alerts;
  const last = p.lastContentAt ?? p.start;
  if (last !== null && now >= last && now - last >= limits.silenceSeconds * 1000) alerts.push({
    id: 'silence', kind: 'silence', turn: p.turn, steps: [p.step], seqs: [],
    title: `${Math.floor((now - last) / 1000)} 秒未收到模型内容`,
    detail: '可能是首响应等待、连接或服务端停顿；这不是内部思考时长，也不能据此确定空转。',
  });
  if (p.reasoningFirst !== null && p.reasoningLast !== null && p.reasoningLast - p.reasoningFirst >= limits.reasoningSeconds * 1000) alerts.push({
    id: 'reasoning-span', kind: 'reasoning-span', turn: p.turn, steps: [p.step], seqs: [],
    title: `本次可见推理采样跨度 ${Math.round((p.reasoningLast - p.reasoningFirst) / 1000)} 秒`,
    detail: '只按已收到片段的首末时间计算，可能包含片段间等待。时长偏长不是任务质量结论。',
  });
  return alerts;
}
export function mergeModels(views) {
  const map = new Map();
  for (const view of views) for (const m of view.models ?? []) {
    const key = JSON.stringify([m.provider, m.model, m.effort ?? null]);
    let row = map.get(key);
    if (!row) { row = { provider: m.provider, model: m.model, ...(m.effort ? { effort: m.effort } : {}), sessions: 0 }; map.set(key, row); }
    row.sessions++;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) row[k] = (row[k] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
}
/** Cross-session per-tool aggregation; stepTokens counts the producing step's usage per call. */
export function mergeTools(views) {
  const map = new Map();
  for (const view of views) for (const t of view.toolStats ?? []) {
    if (!t || typeof t.name !== 'string') continue;
    let row = map.get(t.name);
    if (!row) { row = { name: t.name, calls: 0, errors: 0, toolMs: 0, stepTokens: 0, resultChars: 0, sessions: 0 }; map.set(t.name, row); }
    row.sessions++;
    for (const k of ['calls', 'errors', 'toolMs', 'stepTokens', 'resultChars']) if (Number.isFinite(t[k])) row[k] += t[k];
  }
  return [...map.values()].sort((a, b) => b.stepTokens - a.stepTokens || b.calls - a.calls);
}
/** Cross-session per-skill aggregation over model `skill` tool calls and `/name` user invocations. */
export function mergeSkills(views) {
  const map = new Map();
  for (const view of views) for (const t of view.skillStats ?? []) {
    if (!t || typeof t.name !== 'string') continue;
    let row = map.get(t.name);
    if (!row) { row = { name: t.name, modelCalls: 0, userCalls: 0, errors: 0, toolMs: 0, stepTokens: 0, injectedChars: 0, lastSeen: 0, sessions: 0 }; map.set(t.name, row); }
    row.sessions++;
    for (const k of ['modelCalls', 'userCalls', 'errors', 'toolMs', 'stepTokens', 'injectedChars']) if (Number.isFinite(t[k])) row[k] += t[k];
    if (Number.isFinite(t.lastSeen) && t.lastSeen > row.lastSeen) row.lastSeen = t.lastSeen;
  }
  return [...map.values()].sort((a, b) => b.stepTokens - a.stepTokens || (b.modelCalls + b.userCalls) - (a.modelCalls + a.userCalls));
}
/** Display label for one workspace path; basename across / and \ separators. */
export function workspaceLabel(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '未记录目录';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : cwd;
}
/** Per-workspace aggregation. rows carry {cwd, value}; models retained per workspace for cost estimation. */
export function mergeWorkspaces(rows) {
  const map = new Map();
  for (const r of rows ?? []) {
    const view = r?.value;
    if (!view) continue;
    const cwd = typeof r.cwd === 'string' && r.cwd ? r.cwd : (typeof view.cwd === 'string' && view.cwd ? view.cwd : null);
    const key = cwd ?? '';
    let w = map.get(key);
    if (!w) {
      w = { cwd: key, label: workspaceLabel(key), sessions: 0, prompts: 0,
        tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        modelMs: 0, toolMs: 0, tools: 0, errors: 0, modelMap: new Map() };
      map.set(key, w);
    }
    w.sessions++;
    w.prompts += view.prompts ?? 0;
    w.tokens += view.totals?.tokens ?? 0;
    w.input += view.totals?.input ?? 0;
    w.output += view.totals?.output ?? 0;
    w.cacheRead += view.totals?.cacheRead ?? 0;
    w.cacheWrite += view.totals?.cacheWrite ?? 0;
    w.modelMs += view.totals?.modelMs ?? 0;
    w.toolMs += view.totals?.toolMs ?? 0;
    w.tools += view.totals?.tools ?? 0;
    w.errors += (view.totals?.toolErrors ?? 0) + (view.totals?.retries ?? 0);
    for (const m of view.models ?? []) {
      if (typeof m.model !== 'string') continue;
      let mr = w.modelMap.get(m.model);
      if (!mr) { mr = { model: m.model, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; w.modelMap.set(m.model, mr); }
      for (const k of ['tokens', 'input', 'output', 'cacheRead', 'cacheWrite']) if (Number.isFinite(m[k])) mr[k] += m[k];
    }
  }
  return [...map.values()].map(({ modelMap, ...w }) => ({
    ...w, modelRows: [...modelMap.values()].sort((a, b) => b.tokens - a.tokens),
  })).sort((a, b) => b.tokens - a.tokens);
}
/**
 * RC1 follow() can promote a cold Session after its first yielded snapshot.
 * Do NOT use follow() to scan sessions, even with early abort.
 * list() provides attached projections and cold hints without Agent activation.
 * @param {any} remote
 * @param {{signal?:AbortSignal,limit?:number,onProgress?:(value:any)=>void}} options
 */
export async function scanSessions(remote, { signal, limit = 30, onProgress = () => {} } = {}) {
  const res = await remote.session.list({}, signal);
  signal?.throwIfAborted();
  const rawItems = res?.value?.items ?? res?.items ?? res;
  if (!Array.isArray(rawItems)) throw new TypeError('Session list response has no items array');
  const items = rawItems;
  const unique = [...new Map(items.filter(x => typeof x.sessionId === 'string' && !x.blank).map(x => [x.sessionId, x])).values()];
  const picked = unique.slice(0, Math.min(500, Math.max(1, limit)));
  const rows = picked.map(row => {
    const rawCandidate = row.projections?.values?.watcherInsights;
    const candidate = rawCandidate?.val ?? rawCandidate;
    let value = null, error = null;
    if (row.origin === 'subagent') error = '直接子代理暂未纳入；避免重复计算继承前缀';
    else if (candidate?.version === 2 && candidate.sessionId === row.sessionId && candidate.totals && Array.isArray(candidate.models) && Array.isArray(candidate.findings)) value = candidate;
    else error = '尚无 Watcher 统计缓存；在加载插件后运行或打开此会话，再刷新统计';
    return { sessionId: row.sessionId, value, error, updatedAt: Number(row.updatedAt) || 0, cwd: typeof row.cwd === 'string' ? row.cwd : null };
  });
  const result = { rows, total: unique.length, selected: picked.length };
  onProgress(result);
  return result;
}
