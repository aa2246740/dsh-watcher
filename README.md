# dsh-watcher

**Watcher（Agent 观察者）** 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) WebUI 的只读外部插件。

它把冗长的 Session 事件整理成一张可下钻的工作路径：先看 Agent 正在做什么、工作如何推进，再定位到某一步里的每一次真实执行及其结果。

> See the full Agent work path without changing it.

## 为什么需要 Watcher

- **回合 → 阶段 → 步骤 → 执行**：概览保持简洁，证据逐层下钻，不把不同命令粗暴合并成一个 `×N`。
- **真实并行**：同一 Step 的多次调用按独立分支呈现，每次执行都能单独定位。
- **有证据才命名模式**：参数完全相同且前次失败或未知才标记“重试”；目标相同但参数变化才标记“迭代”。没有证据就不声称“循环”。
- **状态不粉饰**：区分进行中、等待用户、成功、失败、已返回、已中断和未知；存在返回值不等于成功。
- **结果可读，也可核验**：终端、文件、Diff、JSON 和 Markdown 使用 DSH 原生组件呈现；原始结果始终可以查看和复制。
- **不抢操作权**：默认跟随最新工作；用户查看历史后自动固定，新事件只增加未读提示。
- **克制的生命感**：Agent 工作时眼睛会轻微巡视；所有动效支持 `prefers-reduced-motion`。

Watcher 不向 Agent 注入消息，不暴露隐藏推理，不修改任务，也不替代官方 Trajectory。它只读取 WebUI 已提供的会话快照和呈现元数据。

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

测试覆盖不同 Bash 调用不误合并、并行身份、真实重试与迭代、跨回合边界、内部退出码、孤立结果、用户审批与 steering、图片附件、长原始结果和尾部残缺 JSONL。

## 代码结构

```text
src/
├── dsh-watcher.ts       # Host 入口：只加入 Web client graph
├── client/              # 原生 React 界面、结果阅读器和动效
├── observation/fold.ts  # Session 快照 → 可信工作图
└── hub/                 # 概览状态与 Follow 行为
```

完整交互和视觉约束见 [DESIGN.md](./DESIGN.md)。

## 开源与边界

- 本项目采用 [MIT License](./LICENSE)。
- `dshx` 是非官方的 DeepSeek Harness 外部插件开发工具。
- DeepSeek Harness 及其名称归原项目所有；Watcher 不代表 DeepSeek 官方项目。
