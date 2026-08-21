---
version: alpha
name: Watcher Work Picture
description: A quiet, truthful observability instrument for understanding a DSH agent's turns, steps, model stages, parallel actions, retries, and evidence without reading the full transcript.
colors:
  primary: "#4D6BFE"
  text-primary: "#17181C"
  text-secondary: "#5F636D"
  text-tertiary: "#858A94"
  surface-menu: "#FFFFFF"
  surface-subtle: "#F5F6F8"
  border-subtle: "#E2E4E9"
  accent: "#4D6BFE"
  success: "#1E9E62"
  warning: "#B26A00"
  error: "#D83B3B"
typography:
  ui-body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.55"
    letterSpacing: "0"
  ui-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "1.4"
    letterSpacing: "0"
  ui-label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "1.5"
    letterSpacing: "0"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.55"
    letterSpacing: "0"
rounded:
  control: "8px"
  panel: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  watcher-trigger:
    backgroundColor: "{colors.surface-menu}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    size: "32px"
  watcher-panel:
    backgroundColor: "{colors.surface-menu}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: "{spacing.md}"
  work-action:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.control}"
    padding: "{spacing.sm}"
---

## Overview

Watcher is a read-only session-header utility for people supervising long-running DSH agents. Its primary job is to answer three questions quickly: what is happening now, how the work reached this point, and what exactly happened in a selected execution. It complements the official Trajectory view; it does not replace or duplicate the full transcript.

The visual direction is a quiet editorial instrument: a session summary, collapsible Turn/phase/Step chapters, a chronological Step/execution rail, an optional reversible analysis lens, and a structured inspector that grows beside it. `逐项` keeps the causal path literal; `归类` groups only evidence-backed operation identities and always expands back to every source occurrence. Selection reveals evidence without being required to discover that the action happened. The living eye is the only brand-like memory feature. Repeated cards, decorative gradients, glass, large shadows, and unearned badges are intentionally excluded.

## Colors

The implementation consumes DSH `--dsw-*` semantic tokens so light and dark themes remain native. Front-matter colors document role and contrast intent; they are fallback references, not permission to hard-code a parallel theme. Error, running, success, and unknown states always include text or icons and never rely on color alone.

## Typography

Interface copy uses the host system family. Body and metadata are 13px and 12px respectively; code and raw results are 13px. Node titles use 15–16px. Tabular figures are required for Turn, Step, duration, exit code, and counts. Critical paths and commands wrap or scroll into a full-view surface; they are never silently truncated.

## Layout

The desktop panel is a two-column instrument: a 340–390px work picture on the right and a 380–460px inspector on the left after selection. The work picture is primary on first open. At narrow widths the inspector stacks beneath the work picture without page-level horizontal scrolling. The execution rail follows the latest recorded occurrence until the user selects or scrolls away; new occurrences and live-result updates then append in place and increment an explicit new-progress count without moving the reader. Historical Turns start collapsed; the latest Turn and any authoritative pending interaction start expanded. Turn, phase, Step, and analysis clusters are independently keyboard-toggleable. A historical failure remains visible evidence but does not force disclosure or imply a user action.

Information hierarchy:

1. Current status, current action, and session wall-clock ledger.
2. Conversation-Turn chapters with total elapsed time and performance evidence.
3. Semantic phase dividers, then every Step with a nested model stage and every recorded occurrence with its own identity and elapsed interval.
4. Inside a model stage: first-response wait, provider-visible reasoning, output/tool-intent generation, and retry/unattributed time when authoritative boundaries permit the split.
5. Structured result, arguments, timing, and full raw evidence after occurrence selection.

Observation modes:

- `逐项` is the default causal view. It renders every Step and occurrence in time order.
- `归类` is a reversible analysis view inside each phase. Exact tool calls group only when normalized tool and arguments match; mutable file operations may group by the same operation and target so iterations stay comparable; reads may group by one exact file target across line windows. Bash, Glob, Grep, and search calls never merge from a shared cwd, broad path, tool name, or translated label.
- A collapsed analysis cluster shows occurrence count, distinct Step count, and outcome distribution. Expanding it restores every numbered occurrence with its original Step, duration, status, retry, and iteration evidence.

## Elevation & Depth

Use the host menu surface, one border, and the host level-3 menu shadow. Depth communicates that the utility is anchored above the session header; nested content uses dividers and surface contrast, not more shadows.

## Shapes

The panel uses the host 12px menu radius. Rows use 8px only when they are interactive. Pills are reserved for semantic state or user controls. The rail is a one-pixel rule with compact junctions for parallel actions; it is not a decorative flow line.

## Components

### Work picture

- One collapsible chapter per Turn; it must never merge across Turn boundaries. Turn headers carry duration and useful totals, not a duplicated status dot.
- One independently collapsible divider per consecutive user-facing phase; the closed header preserves exact Step/execution totals and elapsed time.
- Every Step is independently collapsible beneath its phase. Its closed header preserves Step number, elapsed time, parallel count, and execution count.
- Every Step may contain one independently collapsible `模型阶段`. Its closed row preserves total model time and visible-reasoning time; opening it reveals a proportional time rail and provider-exposed reasoning attempts without turning reasoning into a peer Step.
- Historical model stages default closed. The latest actively streaming model stage defaults open. Provider-exposed reasoning text is a second disclosure below its timing row; explicitly opening it pins its parent model stage open across streaming settlement, and the record never disappears merely because a later tool call arrived.
- In `逐项`, every tool/message occurrence keeps a stable numbered row. In `归类`, every occurrence remains available under one evidence-backed cluster and keeps the same stable selection identity.
- Parallel calls retain one Step bracket and separate selectable rows. Retry and iteration labels sit on the exact affected occurrence. A cluster may show `×N` only as a reversible summary whose expanded children prove the N source records.
- Occurrences already seen by Watcher survive RC8 history-window advancement. Opening Watcher automatically walks the public Session `loadOlder()` pages until the full log is present; a later result replaces the same stable occurrence and never removes or duplicates the running row. While pages are still arriving, whole-session projections expose loaded-versus-total progress and the visible evidence remains explicitly partial.
- `N 次执行` means distinct recorded occurrences. `重试 N 次` requires the same normalized tool and arguments after a failed or unknown attempt. `迭代 N 版` requires the same target with changed input. `循环 N 次` is forbidden unless the same multi-action path is proven to repeat.
- User steering, interruptions, turn failures, images/artifacts, and waiting states are first-class when the official snapshot exposes them.

### Inspector

- Layer 1 is a plain-language summary and status.
- Layer 2 is structured evidence: command, arguments, path, duration, exit code, and render-intent result.
- Layer 3 is complete raw evidence with an explicit disclosure and copy path. Preview caps may collapse the middle, but the complete value remains reachable.
- On narrow screens, selection uses a single-pane drill-down: the Inspector replaces the Work Picture and exposes an explicit `返回工作路径` control. Desktop keeps both panes visible for comparison.
- Shell results use `TerminalBlock`; reads use `ReadBlock`; file changes use `DiffBlock`; structured objects use `JsonTree`.
- Text results use the official `MarkdownText` reading pipeline: proportional prose, semantic headings/lists/tables/quotes, inline code, and highlighted fenced code. The Raw tab remains the exact, copyable source and is the fallback whenever users need byte-level evidence.
- Untrusted Markdown never enters an HTML parser in Watcher. Unsafe protocols, relative links, and raw HTML follow the official primitive's fail-closed policy.

### State language

Overview progress and execution evidence are separate axes. Overview markers answer only “where should I look?”; execution statuses answer “what evidence was returned?”.

- The header owns the one normal liveness phrase (`正在执行`, `已停稳`, or `等待任务`). Normal active/current Turn and phase rows use position, disclosure, and a blue marker without repeating `现在`, `当前`, or `进行中` text.
- Overview `等待你`: an authoritative pending approval or question; amber marker plus visible text. This is the only overview state that asks the user to act.
- Overview `有失败记录`: historical or latest failure evidence; red marker plus visible text, without claiming that recovery is still required.
- Overview `已中断`: explicit interruption evidence; red marker plus visible text, without claiming that the user can or must repair it.
- Overview `已结束`: historical settled phase, regardless of whether its evidence is authoritative success or neutral return; filled neutral marker, never an empty ring.
- Overview `数据不完整`: required history is unavailable; dashed marker plus visible text.

- `进行中`: the call has no result yet.
- `成功`: authoritative success evidence exists, such as exit code 0 or a non-error typed result.
- `失败`: `isError`, a terminating signal, a nonzero authoritative exit code, or a Turn error exists.
- `已返回`: a result exists but the domain did not declare success; this is neutral, never green by inference.
- `等待你`: a pending approval or question is authoritative in the observed data.
- `已中断`: the agent or Turn explicitly stopped.
- `未知`: required evidence is outside the loaded window or unavailable.
- `成功` remains an execution-level evidence claim. A Turn or phase never becomes green merely because one child succeeded.
- Header emphasis describes the current edge only: a pending interaction, latest failure, or interruption. Red means anomalous evidence, not an assigned user task. Historical failures stay visible in their chapters but never keep the eye red after later work has moved on.

## Do's and Don'ts

Do preserve Turn, Step, parallel, and per-execution identity. Do show neutral `已返回` when success is not known. Do keep commands, paths, and output readable at normal zoom. Do use DSH primitives and tokens before inventing local components.

Do not merge actions merely because their tool or Chinese label matches. Different Bash commands remain separate clusters. Changed mutable inputs may share one target-based iteration cluster, but every version remains expandable and selectable. Do not call adjacency a loop. Do not infer success from the mere presence of a result. Do not silently cut raw output. Do not add steering or diagnosis. Never reconstruct, summarize as fact, search-index, or claim access to hidden chain-of-thought; only provider-exposed reasoning already present in the user's DSH session may be disclosed.

## Design Mandate

- Product intent: turn raw session execution into a calm, truthful work picture rather than another transcript viewer.
- Deliverable: Watcher as an external DSH Web client plugin.
- Primary audience: DSH users supervising active or completed agent sessions.
- Core job to be done: understand the agent's current action and causal workflow, then inspect any exact execution without reading raw session JSONL.
- Original user request: expose the Agent/model Thinking time because it is often a material part of total task duration, and discuss the truthful data boundary before implementation.
- Latest user override: implement the agreed multi-level model-stage hierarchy inside each Step.
- Success criteria: one continuous hierarchy (`会话 → 对话轮次 → 阶段 → 步骤 → 模型阶段 / 每次执行`) with independent Turn/phase/Step/model disclosure; first-response wait, provider-visible reasoning, output/tool-intent generation, and retry/unattributed time remain semantically distinct; exposed reasoning survives streaming settlement and can be expanded by attempt; missing reasoning timing or token usage is named rather than estimated; a `逐项 / 归类` switch whose grouped summaries expand to exact source rows; no different-command Bash aggregation; complete/current-window session span split into time inside Turns and gaps between Turns; exact or explicitly lower-bound Turn/phase/Step/execution elapsed time; per-turn decode performance that separates model, tool, and first-token latency; progress markers that never impersonate radio buttons; no aggregate green success; precise execution drill-down; semantic Results and exact raw evidence; official WebUI compatibility; no DSH core edit; no Host restart for client-only updates, with one page refresh after first installation.
- Must preserve: observation-only scope, header utility seat, DSH token language, Follow behavior, HMR lifecycle, keyboard access, and `prefers-reduced-motion`.
- Non-goals: agent steering, reconstructing hidden reasoning, AI-generated reasoning summaries, default reasoning search/export, a second model, process control, DSH core modification, or cloning the full official Trajectory ledger.
- Validation must check against: the supplied full-session log's provider-exposed reasoning stream; exact per-attempt and per-execution identity; timing labels that do not rename queue/network/prefill latency as Thinking; WebUI keyboard, overflow, type-size, and reduced-motion behavior; TypeScript, bundle, and dshx contracts.

## Content Model

Canonical rail nouns are `对话轮次` (Turn; rendered as `对话轮次 N`), user-facing phases such as `理解任务`, `检查与理解`, `修改实现`, `验证结果`, and `给出答复`, `步骤 N` (recorded Step), `模型阶段`, its measured children `首响应等待`, `可见推理`, `输出 / 工具意图`, and one numbered occurrence per recorded action. `可见推理` means provider-exposed reasoning chunks only; `模型处理中` is used before such evidence exists. Observation modes are `逐项` and `归类`; a reversible aggregate is `同类执行`, not a loop. Avoid the game-like `回合`, ambiguous `节点`, generic unexpandable `动作 ×N`, unqualified `思考耗时`, and `循环` without proof. The first view answers “状态 / 路径 / 时间”; selection opens “证据”. `结果` is the interpreted reading view; `原始` is the exact recorded source.

Empty copy explains that the first Turn will grow here. Partial-data copy names what is unavailable. Errors state both what failed and the available recovery path. Long localized copy wraps; Chinese and English tool names may coexist without sentence concatenation.

## Performance Semantics

Time is a nested wall-clock path, not a sum of command runtimes. The session ledger first distinguishes complete history from the currently loaded window, then splits the visible span into time inside conversation Turns and gaps between Turns. Each Turn, phase, Step, and individual execution exposes its own interval so a long-running outlier remains traceable without pretending that parallel children add linearly.

Performance belongs to the conversation-turn chapter because its diagnostic value comes from comparing one Turn with another. The collapsed header shows total elapsed time and measured decode speed, so an outlier is visible before drill-down. The expanded chapter adds one quiet, non-card strip for `模型`, `工具`, and `首 token`; it does not repeat execution-level durations.

- `会话总跨度`: first loaded `turn/start →` final `turn/end`; while live, the end is the current wall clock. If earlier history is not loaded, the label changes to `已加载跨度` and the overview says `历史未完整加载`.
- `轮次内耗时`: union of visible Turn intervals. It includes model, tools, approvals, and in-Turn waits, but overlapping intervals are counted once.
- `轮次间隔`: session/window span minus the union of Turn intervals. It exposes user thinking time, idle gaps, or a paused continuation instead of hiding them inside Agent work.
- `对话轮次总耗时`: `turn/start → turn/end`; while the latest Turn is running, the end is the current wall clock and updates once per second. If the Turn start is clipped, the UI says `已记录 … · 开头未载入` instead of presenting a complete total.
- `阶段耗时`: first Step start → last Step end within one consecutive phase.
- `步骤耗时`: `step/start → step/end`, including model generation, tool calls, and waits recorded inside that Step.
- `执行耗时`: `tool/call → tool/result`; a running tool uses call time → current wall clock.
- `模型阶段`: `step/start → assistant/message`; while streaming, the end is the current wall clock. This includes retry waits and provider latency and therefore is not labelled Thinking.
- `首响应等待`: `step/start →` first non-empty reasoning/text/tool delta. It may include queueing, network, input prefill, and internal inference, so it is never renamed `思考`.
- `可见推理`: the union/sum of each attempt's first provider-exposed `reasoning-delta →` last `reasoning-delta` span. A single recorded delta has a measured span of 0ms; reasoning text without chunk timestamps has content but unavailable duration.
- `输出 / 工具意图`: last visible reasoning delta → assembled `assistant/message`; without reasoning, first non-empty output delta → assembled message. It includes final text or tool-call generation, not tool execution.
- `重试 / 未归因`: only the non-negative remainder needed to reconcile a multi-attempt model stage after the measured spans above. It appears only with retry evidence or an otherwise real uncovered interval and is not guessed into another category.
- `推理 token`: provider-reported `reasoningTokens` only. Missing provider usage remains `未上报`; output tokens are never substituted.

- `模型`: sum of recorded `step/start → assistant/message` intervals in the Turn.
- `工具`: sum of recorded `tool/call → tool/result` intervals in the Turn.
- `首 token`: the lowest visible Step's `step/start → first non-empty token` interval.
- `token speed`: provider-reported output tokens divided by `first token → assistant/message` decode time, summed only across Steps carrying both facts.

The model/tool figures are diagnostic recorded sums, not slices of a pie: parallel tools can overlap each other and model activity, so they are not required to add up to Turn elapsed time. Missing timing or provider usage is absence, not zero. Watcher omits the affected reading and never divides tokens by total Turn duration, tool time, approval wait, or wall-clock time. Values use direct units and tabular figures; color does not declare “fast” or “slow” without a user-defined baseline.

## Information Architecture

- Primary task: scan every Step, its model-time decomposition, and every occurrence in the causal work rail while it grows.
- Secondary task: fold Turn/phase/Step/model levels or switch to same-kind analysis without losing source identity.
- Tertiary task: select one occurrence, inspect it, then copy or expand complete raw evidence.
- Navigation model: header trigger → work picture → observation mode → Turn → phase → Step → model stage / reasoning attempt or execution → structured/raw evidence.
- Required states: empty, opening, following, pinned/unread, expanded/collapsed, itemized/grouped, model-waiting, reasoning-streaming, reasoning-settled, reasoning-content-without-timing, reasoning-unavailable, running, parallel, returned-neutral, success, failure, waiting-user, interrupted, partial-history, and reduced-motion.

## Taste Signature

- Design read: a high-frequency desktop observability tool; clarity and trust outrank expression.
- Necessary judgment: demote totals and decoration; preserve causal boundaries, exact identity, and evidence.
- Taste dials: variance 3/10, density 7/10, motion 3/10, distinction 5/10, type expression 2/10, experiment risk 2/10.
- Category defaults avoided: dashboard card grids, AI gradients, glass, decorative badges, animated flow backgrounds, and fake “premium” minimalism.
- Layout families: continuous work rail plus evidence inspector.
- Visual memory feature: the eye quietly scans while the agent is live, then centers at rest.
- Type personality: native utility type recedes; code remains legible and exact.
- Asset policy: only official snapshot evidence and supplied DSH primitives; no fake screenshots or inferred proof.

## Necessary Judgment

- Removed or demoted: fake loops, unexpandable `×N` aggregation, singleton aggregate wrappers, generic green completion, tiny code, and nested card chrome.
- Must remain: Turn/Step causality, per-execution identity, reversible aggregation, Follow, structured/full evidence, and observation-only copy.
- Inevitable relationships: status belongs to execution evidence; parallelism belongs to one Step; inspector selection belongs to one stable occurrence.
- Craft tolerances: 12px minimum metadata, 13px code/body, 44px comfortable row targets where space permits, aligned rail junctions, 120–220ms transitions.
- Care states: empty, partial history, long output, keyboard focus, reduced motion, failure, and pending interaction.
- Material honesty: result presence is not proof of success; pattern labels require evidence.
- Scene fit: dense enough for supervision, quiet enough to leave the conversation primary.

## Motion Strategy

- Motion purpose: feedback and continuity, with one small liveness memory cue.
- Motion budget: Micro / Component.
- Primary focus: panel origin, stable-row selection, quiet live append, and the live eye pupil.
- Do-not-move zones: commands, output, code, Turn labels, error copy, counters, and the work rail geometry.
- Trigger model: panel on open; one short append cue for a newly mounted occurrence; row state on hover/focus/selection; eye only while the session is running.
- Duration/easing: press 100ms, hover/focus 140ms, panel 180ms `cubic-bezier(.2,.8,.2,1)`, selection 160ms. No delayed stagger.
- Reduced motion: no pupil scan or blink; panel and selection appear immediately; all information remains visible.
- Performance: transform and opacity only for motion; at most the eye and one panel transition run concurrently.

## Motion Contract

| Motion id | Promise | Route | Trigger | Acceptance |
|---|---|---|---|---|
| `watcher-eye-scan` | While live, the pupil makes a subtle horizontal scan and occasional blink; at rest it centers. | CSS keyframes | `[data-live]` state | pupil stays within 1.5px, does not encode status alone, stops under reduced motion |
| `watcher-panel-enter` | The panel appears from its trigger origin without delaying interaction. | CSS animation | open | 180ms or less, transform/opacity only, no first-paint flash |
| `watcher-selection` | Selected execution gains immediate stable emphasis. | CSS transition | focus/press/selection | 160ms or less, interruptible, no layout movement |
| `watcher-live-append` | A newly recorded occurrence enters once and remains in the rail. | CSS keyframes | stable occurrence mount | 140ms, transform/opacity only, no stagger, disabled under reduced motion |

Implementation markers: `data-ud-motion="watcher-eye-scan"`, `data-ud-motion="watcher-panel-enter"`, `data-ud-motion="watcher-selection"`, and `data-ud-motion="watcher-live-append"`. Browser validation samples running, settled, appended, and `prefers-reduced-motion: reduce` states.

## OKF Preflight

- Execution mode: single-agent implementation.
- Active references loaded: information architecture, state language, semantic binding, taste engine, necessary design judgment, typography system, data visualization, motion language, motion contract, accessibility/usability, responsive interaction, tokens/components, and design-to-code governance.
- Support references: request integrity, web-product branch, content model, audit/polish, visual verification, and quality gates.
- Constraints extracted: observation-only DSH Web client; provider-exposed reasoning only; `模型阶段` is a Step child rather than a peer action; native semantic tokens and result primitives; no cross-Turn grouping; every disclosure and aggregate is reversible; no unproven retry, iteration, loop, success, hidden-thinking, or token claims; body/code at least 13px; metadata at least 12px; bounded motion with a static reduced-motion fallback.
- Deliberate exceptions: live approval duration is shown only when an authoritative registered view exposes it; offline golden replay may inspect the complete historical event stream.
- Verification hooks: `data-ud-check` on both panels; `data-ud-motion` on the eye, panel, and selection; golden replay assertions; computed-style and overflow browser checks.

## OKF Decision Bindings

| Reference | Decision | Artifact target | Verification |
|---|---|---|---|
| `foundations/information-architecture` | Turn is the chapter, phase is a semantic divider, Step is the primary process node, and `逐项 / 归类` are reversible observation lenses over the same occurrences. | panel structure and disclosure controls | screenshot hierarchy review, accessible disclosure tree, and row identity checks |
| `content/state-language` | Separate overview progress from execution outcome; only an authoritative pending interaction asks the user to act. Failures remain evidence, never an invented to-do. | overview projection and copy | projection unit tests and settled/current/error screenshots |
| `content/semantic-binding` | Native buttons/details, visible labels, full-view path for critical truncation. | React markup | keyboard, accessible-name, and long-output tests |
| `content/message-model` | Put interpreted result before exact raw source; preserve both without duplicating the transcript. | Inspector tabs and text renderer | mixed Markdown visual fixture and raw parity check |
| `systems/taste-engine` | Quiet rail + inspector; reject card-grid and decorative dashboard defaults. | CSS composition | before/after visual critique |
| `foundations/necessary-design-judgment` | Remove duplicated Turn dots, singleton technical counts, and any marker that fails the Delete/Material Honesty tests. | Turn disclosure, phase rows, summary | before/after visual critique |
| `systems/typography-system` | 13px body/code, 12px metadata, tabular execution data. | CSS tokens | computed-style and narrow-width audit |
| `production/data-viz-i18n-legal` | Use direct units, separate latency stages, and never imply a performance verdict without a baseline. | Turn header and performance strip | formula unit tests and visual label review |
| `systems/motion-language` | Micro/component budget; only feedback, continuity, and liveness move. | eye/panel/selection CSS | normal-motion browser sampling |
| `systems/motion-contract` | Stable ids, bounded pupil movement, reduced-motion static fallback. | DOM markers and CSS | normal/reduced computed-style checks |
| `digital/accessibility-usability` | WCAG 2.2 AA posture, keyboard-accessible `aria-expanded` disclosures, pressed-state observation modes, visible focus, and non-color state language. | controls and states | keyboard/disclosure walkthrough and contrast review |
| `digital/responsive-interaction` | Desktop keeps overview and evidence side by side; narrow screens use a full-height, reversible Inspector drill-down without page overflow. | responsive CSS and Inspector back action | desktop and narrow screenshots plus return interaction |
| `systems/tokens-components` | Consume DSH semantic tokens and official result primitives. | CSS and inspector | source audit and component tests |
| `governance/design-to-code-governance` | Design contract precedes implementation and golden regressions protect semantics. | `DESIGN.md`, tests | contract validation plus test run |

## Quality Gates

- No visual grouping crosses a Turn boundary.
- The overview visibly preserves session, Turn, phase, Step, and occurrence boundaries; semantic grouping never replaces the underlying actions.
- Turn chapters do not repeat normal liveness text. Historical Turns default collapsed; the latest, active, waiting, and partial Turns default expanded, and every Turn is keyboard-toggleable. A historical failure does not auto-open merely because it failed.
- A filled neutral marker means historical settled work; blue means current, amber means an authoritative wait for the user, red means failure/interruption evidence, and dashed means partial data. Every non-settled state also has visible text.
- No overview marker is an empty ring, and overview never turns green from an aggregate `some(success)` rule.
- In `逐项`, every Step and occurrence is present in time order. Turn, phase, and Step headers expose independent `aria-expanded` disclosure and preserve counts/duration while closed.
- A Step with provider/model evidence exposes one independently foldable `模型阶段` before its execution occurrences. Its collapsed row preserves model elapsed time and visible-reasoning duration; current streaming evidence may open it automatically, while settled historical model stages remain user-controlled.
- `首响应等待`, `可见推理`, and `输出 / 工具意图` use recorded event boundaries and remain separately labelled. No queue/network/prefill interval is called Thinking, and a multi-attempt uncovered remainder is labelled `重试 / 未归因` rather than forced into another segment.
- Provider-exposed reasoning text is nested under its exact attempt, defaults collapsed, remains available after completion, and is never silently replaced by a generated summary. Reasoning content without timestamps remains readable with `分段耗时不可用`.
- Chunk-level forensic timestamps remain reachable without rendering every token fragment as a default rail row. `reasoningTokens` appears only when the provider reports it; missing values say `未上报` or stay absent.
- In `归类`, singleton actions remain direct rows. Only evidence-backed repeated clusters may show `×N`; expanding a cluster restores every stable numbered occurrence with Step, duration, status, retry, and iteration evidence.
- Different Bash commands never merge. Glob, Grep, and search calls require exact normalized arguments; a shared cwd, broad path, tool name, or translated title is insufficient. Mutable calls may group by exact operation plus target, and reads may group by one exact file target.
- Normal liveness has one visible phrase in the header. `现在`, `当前`, and `进行中` must not appear simultaneously across header, Turn, phase, or occurrence.
- While following, an appended occurrence scrolls into view. While browsing history, only a newly visible occurrence or an existing occurrence entering a terminal state increments `N 条新进展`; reasoning/text/tool-argument stream fragments update their existing record in place and never count as progress of their own. A running occurrence settling updates the same stable row instead of disappearing.
- Advancing the official RC8 history window cannot erase an occurrence already observed in the mounted page; changing sessions resets this observation ledger.
- The header ledger shows `会话总跨度` only for complete loaded history; partial history says `已加载跨度` and `历史未完整加载`. It splits that span into `轮次内耗时` and `轮次间隔`.
- Collapsed conversation-turn headers expose exact elapsed time or an explicit `≥` lower bound and measured `tok/s`; expanded headers separate model time, tool time, and first-token latency without adding a dashboard-card layer.
- Selected phases, Steps, and individual executions each expose their own wall-clock interval. Parallel child durations are never presented as an additive decomposition of their parent.
- Token speed uses only provider-reported output tokens and recorded decode time. Missing timing or usage remains absent, and total Turn duration is never used as its denominator.
- Parallel calls in one Step stay visibly parallel and individually selectable.
- No `循环` label without a proven repeated path.
- No `重试` label unless normalized tool and arguments match and a preceding attempt failed or remained unknown.
- A historical failure must not masquerade as the current state after later work has moved on.
- `需要处理` never appears. Only a pending approval or question may say `等待你`; historical failure copy says `有失败记录`.
- When Trajectory lacks a tool-result location, the official Chat location index is merged for missing sequence ids so live tools do not fall into `会话准备` or lose Turn/Step timing.
- Full output remains reachable beyond any preview cap.
- Text Results use proportional document typography; they must not fall back to one monochrome `<pre>` surface.
- Markdown headings, lists, quotes, tables, links, inline code, and fenced code render semantically; fenced code retains its language banner, highlighting, horizontal containment, and copy action.
- Raw HTML and unsafe or relative link destinations remain inert under the official renderer's untrusted-output policy.
- The Raw tab preserves the exact source and stays copyable even when the Result tab interprets Markdown.
- Inner structured exit codes and official terminal result views drive failure status.
- Body/code/metadata meet 13/13/12px minimums.
- A status primitive never participates in the work-row grid: its plugin-owned absolute wrapper leaves the copy track at normal reading width in every state.
- The Watcher surface is portaled to the viewport layer; no sidebar, banner, transcript, or sticky Composer may paint above any sampled point inside the panel.
- On narrow screens, the overview uses the full available shell height. Selecting an occurrence swaps to a full-height Inspector with a visible `返回工作路径` action; closing that drill-down restores the overview without closing Watcher.
- Escape closes and returns focus; every selectable row has visible focus.
- Desktop and narrow layouts have no page-level horizontal overflow.
- Normal and reduced-motion states pass browser inspection.
- `pnpm typecheck`, focused tests, build, and `dshx check` pass before activation claims.

## Assumptions

- The official RC8 `ConversationSnapshot` and tool presentation views are authoritative when present.
- Older or partial histories may lack call heads, timing, or presentation metadata; the UI names that absence instead of guessing.
- First installation is a `new-client` change: activate the Host row, then refresh the page once so the boot graph includes Watcher. Later client-only rebuilds use the existing-client HMR branch without a Host restart.

## Open Questions

- Approval wait duration is not part of the generic live `ConversationSnapshot`; Watcher shows it only when an authoritative registered view exposes it. The external golden-log parser can still prove historical wait handling without inventing live data.

## Review Log

- 2026-08-20: V2 contract created from the existing plugin, official RC8 Conversation/Trajectory/tool-presentation contracts, and two supplied session logs. Structural repair precedes visual polish.
- 2026-08-20: Supplied screenshots exposed two P0 integration defects: neutral/state dots could become grid children and squeeze copy to 14px, while the header-owned stacking context let shell chrome and the sticky Composer cover the panel. Repaired with a plugin-owned dot wrapper, the official anchored-position hook, and a body portal; pinned-Chromium red-to-green checks passed at 460x724 and 920x900, including an open Inspector over the Composer, without restarting the Host.
- 2026-08-20: File Panel study showed that readable preview should reuse RC8 `MarkdownText` while source remains a separate exact view. Watcher adopted the same semantic pipeline for text Results instead of maintaining a plugin-local parser or monochrome `<pre>` fallback.
- 2026-08-20: First-principles flow audit found that the hollow neutral-return ring looked unfinished, Turn and phase duplicated the same marker, and Step/execution taxonomy leaked into overview copy. Contract revised to three visible levels, separate overview progress from evidence outcome, collapse historical Turns, and suppress singleton technical counts.
- 2026-08-20: Pinned-Chromium narrow review found that a 48vh overview cap and split overview/Inspector made both panes needlessly cramped. Narrow layout now grants the overview the full shell and uses a reversible single-pane Inspector drill-down; desktop remains side by side.
- 2026-08-21: Performance diagnosis added at the conversation-turn boundary. Total elapsed, model time, tool time, TTFT, and decode throughput retain distinct source intervals; missing usage/timing is never estimated. User-facing `回合` copy was replaced by `对话轮次 N` while the RC8 `Turn` domain name remains in code.
- 2026-08-21: Timing audit against the supplied `cdde96b7` log proved that one Turn lasted 2,020,092 ms (33m40s) while the previous UI exposed only short command durations. Watcher now shows session/window span, Turn intervals, phase spans, Step spans, and individual execution time. The same audit found that RC8 Trajectory can omit locations for tool contributions even when the Chat index retains them; missing locations are now merged instead of misfiling 39 executions under session preparation. Historical failures were also relabelled as evidence (`有失败记录`), leaving `等待你` as the only user-action state.
- 2026-08-21: Real 43127 review proved that phase-only aggregation hid 21 distinct executions and that `现在 / 当前 / 进行中` repeated one state across three levels. The work picture now renders every Step and occurrence, uses phase only as a semantic divider, follows occurrence-level updates, and reserves one normal liveness phrase for the header.
- 2026-08-21: Final follow audit found a programmatic scroll could fire the user-scroll handler after returning from Inspector, silently switching `自动跟随` to `浏览历史`. A programmatic-scroll guard now keeps the mode stable. Pinned Chromium 1.61.1 / revision 1228 passed the 460x724 overview-to-Inspector-to-overview path with 61 retained records, no horizontal overflow, no unread banner, and `自动跟随` still active; the live 43127 page was also inspected with 61 retained records and one visible liveness phrase.
- 2026-08-21: Folding/analysis review added independent Turn, phase, Step, and repeated-cluster disclosure plus `逐项 / 归类` lenses. The first live 43127 pass exposed a false Glob cluster: two patterns shared one cwd/path and were incorrectly called `同一目标`. Grouping was tightened so Bash, Glob, Grep, and search require exact normalized arguments; only mutable operation+target and exact file reads get target grouping. A real `修改 package.json ×2` cluster expanded back to Steps 85/86 and collapsed/restored without identity loss. Pinned Chromium 1.61.1 / revision 1228 passed Step collapse/restore and both observation modes at 460x724 with a 436x636 panel and no page overflow.
- 2026-08-21: User review exposed Step 110–113 above delayed wait records from Steps 104/106/108. The rail had incorrectly treated event arrival sequence as global order; delayed approval interactions therefore split and reinserted an earlier Step. Ordering is now authoritative `Turn → Step → occurrence sequence`, locked by a red-to-green regression test and a live 43127 monotonic-order check. The same review replaced mathematical `≥` duration copy with `已记录 … / 开头未载入`, naming the missing start boundary rather than implying mysterious extra time.
- 2026-08-21: The supplied final JSONL proved the fold contains 3 Turns, 203 Steps, and 230 tool actions, while a fresh RC8 client mount exposed only the newest tail page. Watcher now treats opening the panel as intent to inspect the whole path and automatically walks the official Session paging API. Progress is passive; only a blocked/no-progress result exposes retry, and a terminal loading state prevents stale `hasMore` renders from requesting the first page twice.
- 2026-08-21: Provider-event audit of the supplied final JSONL found 91 reasoning-bearing Steps, 1,448 `reasoning-delta` events, 93 durable reasoning blocks, and no reported `reasoningTokens`. The 15m22s model span on those Steps decomposes into 6m17s before first visible reasoning, 4m05s of visible reasoning-stream span, and 4m59s from final reasoning to assembled output. Contract updated to place a foldable `模型阶段` inside each Step, preserve provider-exposed reasoning by attempt, and forbid renaming first-response latency or hidden model work as Thinking.
- 2026-08-21: Critique 1 on the live 43127 page found two P2 reading defects in the first model-stage render: the Step repeated the same `19 s` as both Step and model duration, and the deep reasoning metadata truncated into one cramped line. The repair deduplicates equal Step/model durations, labels unequal parent time as `总`, keeps the deep timing ledger in one column, and lets reasoning metadata wrap onto a second line.
- 2026-08-21: Critique 2 passed on the real five-Turn session at 894x960 and 390x844. The hierarchy remained `对话轮次 → 阶段 → Step → 模型阶段 → 推理记录/尝试 → 工具执行`; `逐项 / 归类`, grouped model-stage disclosure, and reasoning disclosure retained independent state; the grouped view preserved one model record per Step instead of merging prose. Both viewports had document and panel `scrollWidth === clientWidth`, the viewport portal stayed above the Composer, and the user viewport was reset to 894x960. No Watcher P0/P1 remained; the unrelated DSH header collision at 390px is outside the plugin surface.
- 2026-08-21: Live-stream review exposed one identity defect behind two symptoms: the temporary model item used mutable `lastSeq` as its ordering identity, so every `reasoning-delta` replaced the phase/Step id, reset disclosure keys, and incremented unread despite adding no visible node. The regression first reproduced `seq:2 → seq:3` plus `unread 0 → 1`; the repair anchors identity to the first observed model event while retaining `lastSeq` only as an activity/result cursor. Opening a nested reasoning record now also pins its parent model stage open across settlement.
- 2026-08-21: Final same-page 43127 HMR acceptance observed one live reasoning record grow from 28 to 68 fragments while remaining `aria-expanded=true` and keeping unread at 0. At settlement it held 527 fragments, both model and reasoning disclosures remained open, and unread became exactly 1 for the semantic running-to-complete transition. The isolated browser tab was closed afterward; the original 43127 tab and Host process were left running.
