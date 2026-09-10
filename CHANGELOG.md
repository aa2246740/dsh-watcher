# Changelog

## Unreleased

### Adapted to DeepSeek Harness `0.1.5-rc.1`

- Read attempt timing from the durable stream `0.1.5-rc.1` embeds in
  `assistant/message` (and `assistant/attempt`). The version stopped writing
  `assistant/chunk` rows, so first-response, last-content, and reasoning-span
  evidence was silently zero on every new log; the packed `time0`/`dt` delta
  runs inside `stream` carry it instead. Legacy `assistant/chunk` and
  `chunkrow/*` rows still fold, so older transcripts keep working.
- Renamed the live stream event to `assistant/live-chunk` (the `assistant/chunk`
  spelling no longer exists in the Session event map).
- Added an evidence-only fold for `assistant/attempt`, so an attempt that
  settled without a surface message still contributes the timing its stream
  proves before `llm/retry` closes it.
- Raised the Insights projection `stateVersion` to 2: rows folded by the old
  semantics keep reporting zero timing, and the projection cache discards a
  version mismatch instead of migrating it.
- Replaced the external `dshx` build adapter (`tools/dshx/src/client-build.js`,
  absent from the Harness) with `tsdown.config.ts`, which restates the two
  artifact contracts against the Harness's own `packages/client/tsdown.client.ts`
  preset and reads the platform module list from the Harness at build time.
  `scripts/link-harness-dependencies.mjs` links against the 0.1.5-rc.1 layout.
- Raised every `@deepseek-ai/*` peer and dev dependency to `^0.1.5-rc.1`.

- Opening Watcher now restores every older conversation Turn automatically through RC8's public Session paging API. Normal use has no manual "load all" step; paging progress is passive, and a retry appears only when the official loader is busy or cannot advance.
- Added whole-session Turn/Step projections so the progressive UI can show loaded-versus-total evidence while RC8 pages arrive.

- Added independent disclosure for conversation Turns, phases, Steps, and repeated-operation clusters.
- Added `逐项 / 归类` observation modes over the same immutable execution evidence.
- Kept singleton actions direct in grouped mode and made every `×N` summary expandable to its exact source occurrences.
- Restricted grouping so different Bash, Glob, Grep, and search arguments never merge from a shared cwd, path, tool name, or translated label.
- Added evidence-backed grouping for repeated exact calls, mutable operations on one target, and reads of one exact file target.
- Fixed delayed approval/interaction records re-inserting an earlier Step below a later Step; Turn and Step coordinates now own the rail order, while event sequence only orders records inside one Step.
- Replaced the ambiguous mathematical lower-bound label (`≥`) with `已记录 … · 开头未载入` when RC8 omits a Turn's starting boundary.

## 0.3.0 — 2026-08-21

- Added a session wall-clock ledger: complete/current-window span, time inside conversation Turns, and gaps between Turns.
- Added elapsed time at every diagnostic level: conversation Turn, phase, Step, and individual execution.
- Added per-conversation-turn total duration and live elapsed time.
- Added model time, tool time, first-token latency, and measured decode throughput.
- Kept token speed evidence-based: provider output tokens divided by decode time only, with no fallback estimates.
- Fixed live tool results falling into session preparation when Trajectory omitted their location but the official Chat index still had it.
- Replaced the action-implying `需要处理` label with evidence-only `有失败记录`; only a pending approval or question says `等待你`.
- Replaced the game-like Chinese term `回合` with `对话轮次` labels.

## 0.2.0 — 2026-08-20

- First public release under the Watcher name.
- Added a truthful four-level work path: turns, phases, steps, and executions.
- Preserved parallel branches and individual execution evidence.
- Added typed result readers for terminal output, files, diffs, JSON, Markdown, and raw data.
- Added Follow behavior, responsive drill-down, reduced-motion support, and subtle live eye motion.
- Targeted DeepSeek Harness `0.1.0-rc.8` and the dshx external client build contract.
