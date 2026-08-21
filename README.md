# dsh-watcher

**Watcher（Agent 观察者）** 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) WebUI 的只读外部插件。

它把冗长的 Session 事件整理成一张可下钻的工作路径：先看 Agent 正在做什么、工作如何推进，再定位到某一步里的每一次真实执行及其结果。

> See the full Agent work path without changing it.

## 为什么需要 Watcher

- **每层都能折叠**：对话轮次、阶段和步骤分别展开或收起；收起后仍保留准确的步骤数、执行数和耗时。
- **逐项 / 归类双视角**：逐项视图保留完整时间线；归类视图只折叠有证据的同类执行，`×N` 可以再次展开到每条原始记录。
- **不做假合并**：不同 Bash、Glob、Grep 和搜索参数保持分开；同一文件的多次修改可以按目标归类并对照每一版。
- **真实并行**：同一 Step 的多次调用按独立分支呈现，每次执行都能单独定位。
- **有证据才命名模式**：参数完全相同且前次失败或未知才标记“重试”；目标相同但参数变化才标记“迭代”。没有证据就不声称“循环”。
- **状态不粉饰**：区分进行中、等待你、成功、失败、已返回、已中断和未知；存在返回值不等于成功。历史失败只叫“有失败记录”，不会假装还有一件事等你处理。
- **墙钟时间逐层下钻**：先看会话总跨度、轮次内耗时和轮次间隔，再沿着对话轮次、阶段、步骤下钻到单次执行，能看出半小时究竟花在哪一层。
- **逐轮性能诊断**：折叠时横向比较每个对话轮次的总耗时和 token speed；展开后区分模型耗时、工具耗时与首 token 延迟，定位“模型慢、工具慢还是首包慢”。
- **模型阶段再下钻**：每个 Step 可继续拆成首响应等待、供应商可见推理、输出／工具意图和重试／未归因时间；可见 reasoning 正文按尝试保留并默认折叠。
- **稳定的实时阅读**：reasoning 流片段只增量刷新同一条推理记录，不制造“新进展”，也不会让用户刚展开的记录自动收起；即使模型随后结束，用户明确展开的推理与其父层仍保持打开。“新进展”只统计新增可见记录或已有记录进入终态。
- **结果可读，也可核验**：终端、文件、Diff、JSON 和 Markdown 使用 DSH 原生组件呈现；原始结果始终可以查看和复制。
- **不抢操作权**：默认跟随最新工作；用户查看历史后自动固定，新事件只增加未读提示。
- **克制的生命感**：Agent 工作时眼睛会轻微巡视；所有动效支持 `prefers-reduced-motion`。

Watcher 不向 Agent 注入消息，不重建、推测或概括隐藏思维链，不修改任务，也不替代官方 Trajectory。只有供应商已经写入用户 DSH Session 的 `reasoning` / `reasoning-delta` 才能显示，且正文默认折叠；没有这类事件时就明确显示未记录。

性能数字也遵循同一条证据原则：会话跨度覆盖已加载的首个对话轮次到最后或当前轮次，并明确拆出轮次间隔；每轮总耗时来自 `turn/start → turn/end`；阶段和步骤使用各自的首尾边界；单次工具执行来自 `tool/call → tool/result`。模型耗时来自 `step/start → assistant/message`，首响应等待止于第一个非空 reasoning／文本／工具增量，可见推理只计算已记录 reasoning 流的时间跨度；不能由这些事件精确归属的真实余量单列为“重试／未归因”，不会冒充 Thinking。token speed 只用供应商上报的输出 token 除以 `first token → assistant/message` 的实际解码时间。并行区间不会被硬凑成可相加的百分比；缺少 timing、reasoning token 或 usage 时也不猜测、不补零。

当 RC8 首次只向插件提供最近一段历史时，打开 Watcher 会通过官方 Session 分页自动补齐更早记录；补齐期间显示已载入步骤数，不要求用户再点一次按钮。只有官方分页受阻时才显示重试操作。完整历史到达前，顶部仍诚实标注“已加载跨度”，缺少起点的对话轮次显示“已记录 14m 8s · 开头未载入”；这些都是当前证据覆盖的下限，不会被冒充为完整会话总耗时。

## 兼容性

| 项目 | 当前支持 |
|---|---|
| DeepSeek Harness | `0.1.0-rc.8` |
| 运行界面 | WebUI |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 构建工具 | [dshx](https://github.com/aa2246740/dsh-external-plugin-devkit) `0.6.x` |

Watcher 遵循 RC8 的外部插件目录约定，应放在 Harness 的 `my-plugins/` 下构建。

## 安装

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-watcher.git my-plugins/dsh-watcher
pnpm --dir my-plugins/dsh-watcher install --ignore-workspace
pnpm --dir my-plugins/dsh-watcher build
dshx --harness "$PWD" check dsh-watcher
```

首次安装属于 `new-client` 生命周期：Host 可以热挂载，但已经打开的页面不会自动获得新的 client graph 行。

```sh
dshx --harness "$PWD" activation-plan dsh-watcher --change new-client
dshx --harness "$PWD" activate-new-client dsh-watcher --profile web --port 43127
```

命令成功后刷新或重开 WebUI 页面一次。无需为首次新增 client 重启整个 DSH Host。

后续只修改 Watcher client 时，重新执行 `pnpm --dir my-plugins/dsh-watcher build` 即可走当前页面的 HMR；通常不需要 Host 重启或页面刷新。若改动 Host module 或 profile manifest，应先按 dshx 的 lifecycle plan 分类，不能把“产物已同步”当成“界面已生效”。

## 本地验证

在 `my-plugins/dsh-watcher` 中执行：

```sh
pnpm typecheck
pnpm test
pnpm build
dshx check dsh-watcher
```

如需重放真实 Session 的 golden logs：

```sh
WATCHER_GOLDEN_DIR=/path/to/golden-logs pnpm test
```

测试覆盖 Turn／阶段／Step／模型阶段多层折叠、可见 reasoning 流与最终内容、模型重试尝试保留、实时模型占位 Step、可逆同类项归类、不同 Bash/Glob/Grep 调用不误合并、并行身份、真实重试与迭代、跨对话轮次边界、晚到交互记录不打乱 Step 顺序、官方历史分页的自动补齐与停滞保护、会话/轮次/阶段/步骤/执行耗时、局部历史下限、实时工具位置回退、性能指标口径与缺失数据、内部退出码、孤立结果、用户审批与 steering、图片附件、长原始结果和尾部残缺 JSONL。

## 代码结构

```text
src/
├── dsh-watcher.ts       # Host 入口：只加入 Web client graph
├── client/              # 原生 React 界面、结果阅读器和动效
├── observation/         # Session 快照 → 可信工作图与逐轮性能证据
└── hub/                 # 概览状态与 Follow 行为
```

完整交互和视觉约束见 [DESIGN.md](./DESIGN.md)。

## 开源与边界

- 本项目采用 [MIT License](./LICENSE)。
- `dshx` 是非官方的 DeepSeek Harness 外部插件开发工具。
- DeepSeek Harness 及其名称归原项目所有；Watcher 不代表 DeepSeek 官方项目。
