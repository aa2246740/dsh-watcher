中文 · [English](./README.en.md)

# Watcher

```sh
dsh plugin --profile web add github:aa2246740/dsh-watcher
```

PATH 上需要官方 `dsh`（或 `npx @deepseek-ai/dsh`）和 **pnpm**。`dsh plugin add` 会在 `$DSH_HOME/profiles/web` 里跑 pnpm，并因为本包装了 `dsh.bundle.patch` 而写入 profile bundles。然后**重启这个 Host，再刷新页面**。它只写 profile，不会热挂正在跑的进程。

仓库已提交 `lib/`，git 安装不用再构建，也不走 `prepare` / `allowBuilds`。需要 DeepSeek Harness **0.1.5-rc.2**，Node `^22.19.0` 或 `>=24`。

DeepSeek Harness Web 的只读插件。点会话标题栏里的眼睛，把 Session 收成一张能折叠的工作路径：这轮走了几步、跑了几次、花了多久；再展开某一步看并行分支、工具结果，或一条默认折着的推理记录。

它不往对话里塞消息，不编隐藏思维链，也不替代官方 Trajectory。

![从逐项切到归类：两次改 package.json 收成 ×2](docs/screenshots/switch-mode.gif)

![三轮都收着，留下阶段数、执行数和 tok/s](docs/screenshots/collapsed-turns.png)

![第三轮展开：并行步骤还在原来的 Step 里](docs/screenshots/overview.png)

![步骤 2：glob 和 grep 两项并行](docs/screenshots/parallel.png)

![归类：修改 package.json ×2，展开仍是步骤 5 和 6](docs/screenshots/grouped.png)

归类只叠能证明相同的调用。两条不同的 bash 不会被捏在一起。模型阶段只显示供应商已经写进 Session 的可见 reasoning；没有记录就写未记录。

已经 clone 过的目录也可以：

```sh
git clone https://github.com/aa2246740/dsh-watcher.git
dsh plugin --profile web add ./dsh-watcher
```

同样需要 pnpm，然后重启 Host 并刷新页面。

```sh
dsh plugin --profile web remove dsh-watcher
```

DSH.app 的 `desktop` profile 不接受 `github:`。用 `dsh web` 装进 web profile。

交互约定在 [DESIGN.md](./DESIGN.md)。MIT。

## 从源码构建

日常安装不用这一步。改 TypeScript 后用 **pnpm** 重建已提交的 `lib/`：

```sh
pnpm install
pnpm test
node scripts/link-harness-dependencies.mjs /path/to/harness
pnpm build
```

`pnpm build` 需要能解析 `@deepseek-ai/dsh-*` peer 的本机 Harness 检出。装插件不要走这条路径。

冷会话的 Chat 数据尚未到达时，Watcher 显示等待提示，数据到达后再挂载面板。
