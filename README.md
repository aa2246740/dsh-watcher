中文 · [English](./README.en.md)

# Watcher

DeepSeek Harness Web 的只读插件。点会话标题栏里的眼睛，把 Session 收成一张能折叠的工作路径：这轮走了几步、跑了几次、花了多久；再展开某一步看并行分支、工具结果，或一条默认折着的推理记录。

它不往对话里塞消息，不编隐藏思维链，也不替代官方 Trajectory。

![从逐项切到归类：两次改 package.json 收成 ×2](docs/screenshots/switch-mode.gif)

![三轮都收着，留下阶段数、执行数和 tok/s](docs/screenshots/collapsed-turns.png)

![第三轮展开：并行步骤还在原来的 Step 里](docs/screenshots/overview.png)

![步骤 2：glob 和 grep 两项并行](docs/screenshots/parallel.png)

![归类：修改 package.json ×2，展开仍是步骤 5 和 6](docs/screenshots/grouped.png)

归类只叠能证明相同的调用。两条不同的 bash 不会被捏在一起。模型阶段只显示供应商已经写进 Session 的可见 reasoning；没有记录就写未记录。

## 安装

```sh
dsh plugin --profile web add github:aa2246740/dsh-watcher
```

或本地 clone：

```sh
git clone https://github.com/aa2246740/dsh-watcher.git
dsh plugin --profile web add ./dsh-watcher
```

然后重启这个 DSH Host，刷新页面。`dsh plugin add` 只写 profile，不会热挂正在跑的 Host。

```sh
dsh plugin --profile web remove dsh-watcher
```

需要 DeepSeek Harness `0.1.0-rc.8`，Node `^22.19.0` 或 `>=24`。

交互约定在 [DESIGN.md](./DESIGN.md)。MIT。
