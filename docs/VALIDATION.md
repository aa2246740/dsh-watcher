# Validation — 2026-09-08

## 实际完成

本地执行 `node --test tests/insights.test.mjs`：30项通过，0失败，0跳过（Node 22.16，纯逻辑模块；不等同于目标DSH运行时测试）。

覆盖RC1真实形态的tool/call、嵌套ToolResultMessage、错误字段、重复失败、参数规范化、成功/新上下文中断重复链；Token/cache/reasoning口径、无usage取消、错误usage、重复结算、fork继承前缀、模型归属；静默与用户等待、阈值；聚合时绝不调用follow；缓存缺失/身份错误/直接子代理的排除；投影检查点恢复。

新增projection.ts经过TypeScript transpile语法检查，0语法诊断；这不是完整依赖类型检查。

另有insights-packed.test.mjs，验证RC1历史打包流和实时流的片段/时间一致性，需要完整项目构建后执行；尚未将其计入上述30项。

## 未完成

当前执行容器无法解析GitHub及npm域名，无法安装完整DSH依赖或克隆完整仓库。本次GitHub Actions首个构建run 34185169821失败，没有分配的runner或step记录，日志接口返回BlobNotFound；原因不能从这些输出确定，不能称为编译通过或测试通过。

因此尚无完整项目TypeScript构建、全部原有测试、官方DSH Host、浏览器端到端或macOS用户环境的成功验证。安装前需本地执行npm install、npm run build、npm test。

## 人工试用重点

会话摘要是否比重复工作日志更直观；失败证据定位是否容易；未报告用量/旧缓存是否清楚；设置页是否能列出运行过的会话；刷新后历史可见推理是否保持；等待用户时是否没有误报模型静默。
