# Watcher 0.4.0-insights.1 — RC1 源码试用分支

目标运行时：DSH 0.1.2-rc.1。分支 `feat/session-insights-rc1`；不修改 main。本分支需要先在本地构建，不应直接把尚未更新的 lib 当成新版。

## 构建并试用

```sh
git clone --branch feat/session-insights-rc1 https://github.com/aa2246740/dsh-watcher.git dsh-watcher-insights
cd dsh-watcher-insights
npm install
npm run build
npm test
```

Node 22.19+ 或 24+。构建成功后，关闭当前 DSH Host，在运行 dsh 的同一环境执行：

```sh
dsh plugin --profile web remove dsh-watcher
dsh plugin --profile web add "$PWD"
dsh --profile web
```

刷新页面。安装路径不能随意移动。回滚时移除本地插件并重新添加 main 的 `github:aa2246740/dsh-watcher`，再重启 Host；不要删除会话。

## 会话内：概括信息优先

眼睛仍是原入口，不增加 Agent 工作直播条。上方改为本轮/会话分析：已报告 Token、报告覆盖率、模型累计时间、工具失败、接口重试。原有路径保留作证据；更早路径按需加载，不因看摘要而拉全量历史。

初版三类提醒：同参数与同错误的连续失败达到3次；模型内容静默默认30秒（等待用户期间暂停）；已收到可见推理片段的首末跨度默认90秒。只描述观测，不自动停止、换模型或注入消息。重复失败不是确定空转，长推理不是质量不合格。

## 设置：模型统计、异常会话、阈值

设置 → Watcher。默认读取最近30个普通会话的可用统计，可刷新最近100个。按 provider/model 汇总；显示无缓存、未纳入和失败，绝不把缺失算作零。

**重要：该页只读 session.list 提供的附加态投影与冷缓存，不为统计调用 follow。** RC1 的 history.follow 在首个快照之后可能 promote 冷会话，客户端尽早 abort 也不能作“不激活”的可靠保证。首次安装时旧会话可能没有 Watcher 缓存；用户手动打开或运行过该会话后再刷新可纳入。冷缓存可能滞后；这版不是全磁盘扫描器。设置页本身是按需快照，当前会话分析按事件增量更新。

排除直接子代理、其他 Host、绕过普通 Session 记录的标题和压缩等辅助模型调用。不显示账单、成功率或模型质量排行榜。提醒阈值只存当前浏览器，尚非跨浏览器 Host 配置。

## 数据语义

Host 的 watcherInsights 投影折叠完整持久日志，不依赖前端窗口。fork 继承前缀只供配置恢复、不计作新消耗。模型归属优先实际 assistant source。usage分片和最终消息去重；缺失保留未知；DSH缓存与未缓存输入独立计数；推理不重复加入total。

模型耗时采用步骤事件边界；重试后的实际请求起点未知时不伪造延迟样本。可见推理采样跨度不是内部计算时长。实时delta的指标视图按500ms时间桶合并发布，结束立即结算。

工具结果按RC1的ToolResultMessage.content中tool-result块解读，callId与结果对应。指纹只留在Host内部派生状态，界面仅给seq/步骤证据，不新建正文数据库。推理文本仍通过原会话查看。

## 构建说明

现有主项目依赖外部构建配置；此分支提供独立tsconfig和esbuild入口。apply-insights-patch及finalize-insights是幂等源代码迁移，构建前将改动落到现有Watcher源文件。后续合并前应把落地后的代码整理为普通提交，移除一次性迁移脚本；不要把试用构建策略直接扩散到其他仓库。

验证范围请阅读 VALIDATION.md。通过纯逻辑测试不代表官方Host和浏览器已经完成联调。
