# Changelog

## Unreleased

## 0.4.5 — 2026-09-21

- Closing the inspector no longer silently re-arms follow. The `←` back control now clears the pinned selection and leaves the rail where the user left it; only the `查看最新` unread pill still jumps to the newest work.
- Insights settings no longer rescans the whole session list on the first manual range pick: `userPickedRange` is a ref now, so the scan effect runs once per `remote` change. The manual refresh button also no longer writes state after the panel unmounts.
- The Host projection state no longer stores a copy of its own wire view. `viewOf` now derives and caches the view by state identity, so every persisted checkpoint and every per-event `structuredClone` stops carrying a redundant snapshot of itself.
- Timing panel hover card stops claiming the non-terminal slice is "文件读写": it is every non-bash tool, so the title, total, per-call average and verdict labels now say what the number actually is.
- Removed the dead auto-load `useEffect` stub in the Watcher panel and the contract test that pinned it; the test now asserts the explicit history-load button instead.
- Removed the unused `PRICING_OVERRIDE_FILE` constant that pointed at a file path nothing ever wrote.
- Projection warm-up failures are logged via `ctx.logger.warn` instead of being silently swallowed.

## 0.4.4 — 2026-09-19

- Fixed the docked detail column having no way back. `返回工作路径` was hidden by CSS at desktop width, so an opened inspector could not be collapsed at all.
- Closing and opening the inspector is one motion instead of an instant mount/unmount: the detail content leaves toward the work path first, then the column narrows, so the closing edge never slices a readable line. Opening runs the same beats in reverse.
- Fixed the whole Watcher panel flicking left and right during that motion. A clamped panel derives its inline `left` from its own width, and the resize observer re-derived it a frame after layout; the measured frame is now pinned for the transition so only the left edge moves.
- Fixed the inspector header's status line (`对话轮次 … · … 个步骤 · …`) slipping under the work-path card: docked children now use `border-box`, and an over-long status or metadata line wraps instead of being covered.
- Contract tests now pin the docked close control, the content-first collapse beat, the header line staying inside the column, and the pinned panel frame.


## 0.4.3 — 2026-09-19

- npm release of the estimated-cost feature set (same as git `0.4.2`). Use this tag on the registry; `0.4.2` was staged but never became installable.

## 0.4.2 — 2026-09-19

- Added **估算费用 / Estimated cost** next to total token usage on the Watcher insights HUD and the settings summary. Input, output, and cache buckets are priced from the matching rate; a missing model or missing bucket shows **未知 / Unknown** and is never treated as $0.
- Default list prices live in `pricing/models.yaml` (USD per 1M tokens). Official preferred rows win for DeepSeek off-peak (2026-09-18), MiniMax-M2.7 / highspeed pay-as-you-go (2026-09-18), and Anthropic flagship (2026-09-19). Other mainstream OpenAI / Gemini / Grok / GLM / Qwen rows are OpenRouter USD/1M as of 2026-09-19 and may differ from vendor list prices. Rates lag official pages. v1 does not fetch live prices.
- Settings hero Token / 估算费用 share one two-column skeleton (caption, same-size number). The caption already says 估算费用, so **估算，非账单** is not repeated under the dollar. Partial estimates keep the known dollar in the main number and add a quiet **含未标价模型 / Some models unpriced** line only when needed — never `$x + 未知`.
- Settings price editor opens with the **currently effective** table (defaults filled in). Save stores only the diff vs defaults in `localStorage['dsh-watcher:pricing-override:v1']`; reset restores defaults in the editor. Missing rates still show 未知, never $0.

## 0.4.1 — 2026-09-18

- Fixed chart hover cards being cut off at the panel edge. Bar, stacked-line, and heatmap popovers are now portalled to the document body and clamped into the viewport, so a card opened on a late bar keeps its model names, token values, and percentages readable instead of losing its right-hand side to the panel's `overflow: hidden`.
- Hover cards are anchored to the measured bar/cell/point rectangle rather than a percentage of the chart width, so they follow their own bar instead of the chart's midpoint.
- The heatmap popover now closes when the pointer leaves the chart area.

- First-turn `本轮` HUD now copies `request/header` into the open `turn.route`, so the tag shows the real model instead of the initial `unknown` snapshot.
- Stock install is `dsh plugin --profile web add github:aa2246740/dsh-watcher` (pnpm on PATH, then restart the Host and reload). `dsh.bundle.patch` and committed `lib/` make that git spec boot without a `prepare` script.

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
