中文 · [English](./README.en.md)

# Watcher

把一团 Session 收成一张能折叠的 Agent 工作路径。

这是 DeepSeek Harness WebUI 的只读插件。点会话标题栏里的眼睛：先看这轮走了几步、跑了几次、花了多久；再展开某一步，看并行分支、工具结果，或一条默认折着的推理记录。

它不往对话里塞消息，不编隐藏思维链，也不替代官方 Trajectory。

![在官方 Web 里从逐项切到归类：两次改 package.json 收成 ×2](docs/screenshots/switch-mode.gif)

图是官方 DeepSeek Harness Web。Watcher 挂在会话标题栏的眼睛上。这段对话是本地 Session 回放，面板读的是官方 ConversationSnapshot，不是单独做的 foldEvents 页。

## 面板

收起的轮次仍留下阶段数、执行数、总耗时和 tok/s。展开后能看到模型 / 工具 / 首 token 的时间条。

![官方会话里打开眼睛：三轮都收着，留下阶段数、执行数和 tok/s](docs/screenshots/collapsed-turns.png)

![第三轮展开：并行步骤还在原来的 Step 里](docs/screenshots/overview.png)

并行就停在原来的 Step 里，两条分支都能点开。

![步骤 2：glob 和 grep 两项并行](docs/screenshots/parallel.png)

归类只叠得起来的，才叠。同一个 `package.json` 可以 ×2，点开还是两条原始记录；两条不同的 bash 不会被捏在一起。

![归类：修改 package.json ×2，展开仍是步骤 5 和 6](docs/screenshots/grouped.png)

模型阶段只使用供应商已经写进 Session 的可见 reasoning。没有记录就写未记录。正文默认折着。

## 装上

在已经能跑的 DeepSeek Harness 仓库里：

```sh
cd /path/to/deepseek-harness
git clone https://github.com/aa2246740/dsh-watcher.git my-plugins/dsh-watcher
pnpm --dir my-plugins/dsh-watcher install --ignore-workspace
pnpm --dir my-plugins/dsh-watcher build
dshx --harness "$PWD" check dsh-watcher
dshx --harness "$PWD" activation-plan dsh-watcher --change new-client
dshx --harness "$PWD" activate-new-client dsh-watcher --profile web --port 43127
```

第一次是 `new-client`：Host 能热挂，已经打开的页面不会自己长出新的 client。命令成功后刷新或重开 WebUI 一次。

以后只改 Watcher 界面，重新 `pnpm --dir my-plugins/dsh-watcher build` 即可走当前页 HMR。

DeepSeek Harness `0.1.0-rc.8` · Node `^22.19.0` 或 `>=24` · [dshx](https://github.com/aa2246740/dsh-external-plugin-devkit) `0.6.x`

交互约定在 [DESIGN.md](./DESIGN.md)。MIT。Watcher 不代表 DeepSeek 官方。
