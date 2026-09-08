/** Browser-safe calculations; estimates never silently become authoritative usage. */
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
    detail: '可能是首响应等待、网络或服务端停顿；不等于模型一直思考，也不能据此确定空转。',
  });
  if (p.reasoningFirst !== null && p.reasoningLast !== null && p.reasoningLast - p.reasoningFirst >= limits.reasoningSeconds * 1000) alerts.push({
    id: 'reasoning-span', kind: 'reasoning-span', turn: p.turn, steps: [p.step], seqs: [],
    title: `可见推理采样跨度 ${Math.round((p.reasoningLast - p.reasoningFirst) / 1000)} 秒`,
    detail: '只按已收到片段的首末时间计算。时长偏长是提醒，不是任务质量结论。',
  });
  return alerts;
}
export function mergeModels(views) {
  const map = new Map();
  for (const view of views) for (const m of view.models ?? []) {
    const key = JSON.stringify([m.provider, m.model]);
    let row = map.get(key);
    if (!row) { row = { provider: m.provider, model: m.model, sessions: 0 }; map.set(key, row); }
    row.sessions++;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && Number.isFinite(v)) row[k] = (row[k] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
}
/** Reads only opening projection snapshots; iterator return + abort closes each follower.
 * @param {any} remote
 * @param {{signal?:AbortSignal,limit?:number,onProgress?:(value:any)=>void}} options
 */
export async function scanSessions(remote, { signal, limit = 30, onProgress = () => {} } = {}) {
  const { items } = await remote.session.list({}, signal);
  const unique = [...new Map(items.filter(x => !x.blank).map(x => [x.sessionId, x])).values()];
  const picked = unique.slice(0, limit);
  const rows = [];
  for (const row of picked) {
    if (signal?.aborted) break;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    let value = null, error = null;
    try {
      if (row.origin === 'subagent') {
        error = '直接子代理暂不扫描；不混用继承前缀与主会话用量';
      } else {
        for await (const frame of remote.session.follow({ address: { kind: 'session', sessionId: row.sessionId }, maxMessages: 1 }, controller.signal)) {
          if (frame.type !== 'snapshot') continue;
          const candidate = frame.projections?.values?.watcherInsights;
          if (candidate?.version === 1 && candidate.totals && Array.isArray(candidate.models)) value = candidate;
          else error = 'Host 未提供 Watcher 统计：请确认已重启并加载此分支';
          break;
        }
        if (!value && !error) error = '没有收到完整统计快照';
      }
    } catch (cause) { error = controller.signal.aborted ? '读取取消或超时' : String(cause?.message ?? cause); }
    finally { clearTimeout(timeout); controller.abort(); signal?.removeEventListener('abort', abort); }
    if (signal?.aborted) break;
    rows.push({ sessionId: row.sessionId, value, error });
    onProgress({ rows: [...rows], total: unique.length, selected: picked.length });
  }
  return { rows, total: unique.length, selected: picked.length };
}
