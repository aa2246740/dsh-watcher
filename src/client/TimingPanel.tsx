import { useState, useRef } from 'react'
import type { InsightsView } from '../insights/projection.ts'
import css from './TimingPanel.module.css'

const duration = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

const fmtNum = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)

type SliceKind = 'ttft' | 'think' | 'output' | 'bash' | 'file'

export function TimingPanel({
  stats,
  scope,
  tokensPerSecond,
}: {
  stats: InsightsView['totals']
  scope: 'turn' | 'session'
  tokensPerSecond?: number | null
}) {
  const [hoverSlice, setHoverSlice] = useState<SliceKind | null>(null)
  const [popoverLeft, setPopoverLeft] = useState<number>(0)
  const [arrowLeft, setArrowLeft] = useState<number>(120)
  const chartBoxRef = useRef<HTMLDivElement>(null)

  // 1. 各项绝对耗时
  const ttftMs = stats.firstMs ?? 0
  const thinkMs = stats.reasoningMs ?? 0
  const modelTotalMs = stats.modelMs ?? 0
  // 输出耗时为模型总耗时减去首字等待与推理（如果模型总耗时充分），否则按剩余值
  const outputMs = Math.max(0, modelTotalMs - ttftMs - thinkMs)

  const toolTotalMs = stats.toolMs ?? 0
  const bashMs = stats.bashMs ?? 0
  const fileMs = Math.max(0, toolTotalMs - bashMs)

  // 2. 总耗时（以模型总耗时与工具耗时为两大互斥主体计算比例）
  const combinedMs = modelTotalMs + toolTotalMs

  // 如果总耗时为0，给个占位
  const modelPct = combinedMs > 0 ? (modelTotalMs / combinedMs) * 100 : 50
  const toolPct = combinedMs > 0 ? (toolTotalMs / combinedMs) * 100 : 50

  // 3. 内部切片相对各自父级的占比
  const ttftSubPct = modelTotalMs > 0 ? Math.round((ttftMs / modelTotalMs) * 100) : 0
  const thinkSubPct = modelTotalMs > 0 ? Math.round((thinkMs / modelTotalMs) * 100) : 0
  const outputSubPct = modelTotalMs > 0 ? Math.max(0, 100 - ttftSubPct - thinkSubPct) : 0

  const bashSubPct = toolTotalMs > 0 ? Math.round((bashMs / toolTotalMs) * 100) : (toolTotalMs > 0 ? 100 : 0)
  const fileSubPct = toolTotalMs > 0 ? Math.max(0, 100 - bashSubPct) : 0

  // 4. 首响应标注：单次还是平均
  const samples = stats.firstSamples ?? 0
  const ttftLabel = samples > 1
    ? `平均首响应 ${duration(samples ? ttftMs / samples : 0)} (共 ${samples} 次)`
    : `单次首响应 ${duration(ttftMs)}`

  // 5. 判断主要耗时瓶颈
  let bottleneck = '运行正常'
  if (combinedMs > 0) {
    if (bashMs > combinedMs * 0.4 && bashMs > 10000) {
      bottleneck = `终端命令占 ${Math.round((bashMs / combinedMs) * 100)}%`
    } else if (thinkMs > combinedMs * 0.4 && thinkMs > 10000) {
      bottleneck = `深度思考占 ${Math.round((thinkMs / combinedMs) * 100)}%`
    } else if (ttftMs > combinedMs * 0.4 && ttftMs > 8000) {
      bottleneck = `云端排队占 ${Math.round((ttftMs / combinedMs) * 100)}%`
    } else if (modelTotalMs > toolTotalMs) {
      bottleneck = `模型处理占 ${Math.round(modelPct)}%`
    } else {
      bottleneck = `工具执行占 ${Math.round(toolPct)}%`
    }
  }

  // 6. 状态胶囊计算（是否有暗中重试或报错）
  const hasError = (stats.toolErrors ?? 0) > 0
  const hasRetry = (stats.retries ?? 0) > 0
  let statusText = '✓ 0 报错 · 0 重试 (稳定)'
  let statusClass = css.statusOk
  if (hasError && hasRetry) {
    statusText = `! ${stats.toolErrors} 报错 · ${stats.retries} 次重试`
    statusClass = css.statusDanger
  } else if (hasError) {
    statusText = `! ${stats.toolErrors} 次工具报错`
    statusClass = css.statusDanger
  } else if (hasRetry) {
    statusText = `! ${stats.retries} 次网络重试排队`
    statusClass = css.statusWarn
  }

  const handleSliceHover = (slice: SliceKind, e: React.MouseEvent<HTMLElement>) => {
    setHoverSlice(slice)
    if (chartBoxRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      const parentRect = chartBoxRef.current.getBoundingClientRect()
      const sliceCenter = rect.left - parentRect.left + (rect.width / 2)
      const popoverWidth = 240
      const left = Math.max(8, Math.min(parentRect.width - popoverWidth - 8, sliceCenter - (popoverWidth / 2)))
      setPopoverLeft(left)
      // 计算箭头在浮层内部的相对横坐标，确保无论浮层被边缘怎么限制，箭头都 100% 精确垂直对准切片中心
      const arrowPos = Math.max(16, Math.min(popoverWidth - 16, sliceCenter - left))
      setArrowLeft(arrowPos)
    }
  }

  return (
    <div className={css.panelBox}>
      {/* 顶行：标题 + 实时推流速度 + 轮次总耗时 */}
      <div className={css.topRow}>
        <div className={css.titleArea}>
          <span className={css.mainTitle}>耗时分布与瓶颈</span>
          {tokensPerSecond && tokensPerSecond > 0 ? (
            <span className={css.liveSpeed} title="当前模型实际流式生成吞吐">
              <i className={css.speedDot} />
              <span>{tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1)} t/s</span>
            </span>
          ) : null}
          <span className={css.totalDuration}>
            {scope === 'turn' ? '本轮' : '全会话'} 耗时 {duration(combinedMs)}
          </span>
        </div>

        <div className={css.bottleneckText}>
          {combinedMs > 0 ? `主要耗时：${bottleneck}` : '暂无耗时记录'}
        </div>
      </div>

      {/* 核心复合柱图：颜色严格认知映射，微切片一目了然 */}
      <div className={css.chartBox} ref={chartBoxRef}>
        <div className={css.barTrack} role="img" aria-label="耗时复合柱图">
          {/* 1. 模型大类 */}
          <div className={css.modelCluster} style={{ width: `${modelPct}%` }}>
            {/* 首字等待 (冷雾灰蓝) */}
            {ttftSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceTtft}`}
                style={{ width: `${ttftSubPct}%` }}
                onMouseEnter={e => handleSliceHover('ttft', e)}
                onMouseLeave={() => setHoverSlice(null)}
              />
            ) : null}
            {/* 深度思考 (DeepSeek深蓝) */}
            {thinkSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceThink}`}
                style={{ width: `${thinkSubPct}%` }}
                onMouseEnter={e => handleSliceHover('think', e)}
                onMouseLeave={() => setHoverSlice(null)}
              />
            ) : null}
            {/* 正文输出 (明亮天蓝) */}
            {outputSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceOutput}`}
                style={{ width: `${outputSubPct}%` }}
                onMouseEnter={e => handleSliceHover('output', e)}
                onMouseLeave={() => setHoverSlice(null)}
              />
            ) : null}
          </div>

          {/* 2. 工具大类 */}
          <div className={css.toolCluster} style={{ width: `${toolPct}%` }}>
            {/* 终端执行 (深翠绿) */}
            {bashSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceBash}`}
                style={{ width: `${bashSubPct}%` }}
                onMouseEnter={e => handleSliceHover('bash', e)}
                onMouseLeave={() => setHoverSlice(null)}
              />
            ) : null}
            {/* 文件及其他读写 (薄荷浅绿) */}
            {fileSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceFile}`}
                style={{ width: `${fileSubPct}%` }}
                onMouseEnter={e => handleSliceHover('file', e)}
                onMouseLeave={() => setHoverSlice(null)}
              />
            ) : null}
          </div>
        </div>

        {/* 悬停专业分析浮层：位置精准对齐具体切片 */}
        {hoverSlice ? (
          <div
            className={css.popover}
            style={{
              left: `${popoverLeft}px`,
              ['--arrow-left' as any]: `${arrowLeft}px`,
            }}
          >
            <div className={css.popTitle}>
              <span>
                {hoverSlice === 'think' && '深度推导 (思考过程)'}
                {hoverSlice === 'ttft' && '首字排队响应 (TTFT)'}
                {hoverSlice === 'output' && '正文流式输出'}
                {hoverSlice === 'bash' && '本地终端命令 (Bash)'}
                {hoverSlice === 'file' && '文件操作与通用工具'}
              </span>
              <span>
                {hoverSlice === 'think' && `${duration(thinkMs)} (${thinkSubPct}%)`}
                {hoverSlice === 'ttft' && `${duration(ttftMs)} (${ttftSubPct}%)`}
                {hoverSlice === 'output' && `${duration(outputMs)} (${outputSubPct}%)`}
                {hoverSlice === 'bash' && `${duration(bashMs)} (${bashSubPct}%)`}
                {hoverSlice === 'file' && `${duration(fileMs)} (${fileSubPct}%)`}
              </span>
            </div>
            <div className={css.popList}>
              {hoverSlice === 'think' && (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-think)' }} />
                      <span>思考阶段耗时</span>
                    </div>
                    <span className={css.popRight}>{duration(thinkMs)} ({thinkSubPct}%)</span>
                  </div>
                  {stats.reasoning ? (
                    <div className={css.popRow}>
                      <div className={css.popLeft}>
                        <i className={css.dot} style={{ background: 'var(--c-think)' }} />
                        <span>思考消耗 Token</span>
                      </div>
                      <span className={css.popRight}>{fmtNum(stats.reasoning)} Token</span>
                    </div>
                  ) : null}
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>占模型输出比例</span>
                    </div>
                    <span className={css.popRight}>
                      {stats.output > 0 && stats.reasoning ? `${Math.round((stats.reasoning / stats.output) * 100)}%` : '—'}
                    </span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>模型总处理耗时</span>
                    </div>
                    <span className={css.popRight}>{duration(modelTotalMs)}</span>
                  </div>
                </>
              )}
              {hoverSlice === 'ttft' && (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-ttft)' }} />
                      <span>首响应耗时</span>
                    </div>
                    <span className={css.popRight}>{ttftLabel}</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>占模型耗时比例</span>
                    </div>
                    <span className={css.popRight}>{ttftSubPct}%</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>累计首字采样次数</span>
                    </div>
                    <span className={css.popRight}>{samples} 次</span>
                  </div>
                </>
              )}
              {hoverSlice === 'output' && (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-output)' }} />
                      <span>正文流式输出耗时</span>
                    </div>
                    <span className={css.popRight}>{duration(outputMs)} ({outputSubPct}%)</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>输出 Token 数量</span>
                    </div>
                    <span className={css.popRight}>{fmtNum(stats.output)} Token</span>
                  </div>
                  {tokensPerSecond && tokensPerSecond > 0 ? (
                    <div className={css.popRow}>
                      <div className={css.popLeft}>
                        <span>实际推流吞吐速率</span>
                      </div>
                      <span className={css.popRight}>{tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1)} t/s</span>
                    </div>
                  ) : null}
                </>
              )}
              {hoverSlice === 'bash' && (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-bash)' }} />
                      <span>终端 Bash 耗时</span>
                    </div>
                    <span className={css.popRight}>{duration(bashMs)} ({bashSubPct}%)</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>主要运行操作</span>
                    </div>
                    <span className={css.popRight}>测试 / 构建 / 脚本运行</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>工具成功率统计</span>
                    </div>
                    <span className={css.popRight}>
                      {stats.tools} 次 ({stats.toolErrors > 0 ? `${stats.toolErrors} 次报错` : '全部成功'})
                    </span>
                  </div>
                </>
              )}
              {hoverSlice === 'file' && (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-file)' }} />
                      <span>文件读写耗时</span>
                    </div>
                    <span className={css.popRight}>{duration(fileMs)} ({fileSubPct}%)</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>常用操作类型</span>
                    </div>
                    <span className={css.popRight}>read / write / edit / glob / grep</span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <span>执行特征</span>
                    </div>
                    <span className={css.popRight}>本地毫秒级极速 IO</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* 底行：图例呼应 + 状态警报胶囊 */}
      <div className={css.legendRow}>
        <div className={css.legendGroup}>
          <span className={css.legendItem}>
            <i className={css.dot} style={{ background: 'var(--c-ttft)' }} />
            <span>{ttftLabel}</span>
          </span>
          <span className={css.legendItem}>
            <i className={css.dot} style={{ background: 'var(--c-think)' }} />
            <span>思考 {duration(thinkMs)}</span>
          </span>
          <span className={css.legendItem}>
            <i className={css.dot} style={{ background: 'var(--c-output)' }} />
            <span>输出 {duration(outputMs)}</span>
          </span>
          <span className={css.legendItem}>
            <i className={css.dot} style={{ background: 'var(--c-bash)' }} />
            <span>工具 {duration(toolTotalMs)}</span>
          </span>
        </div>

        {/* 状态胶囊 */}
        <div className={`${css.statusPill} ${statusClass}`}>
          {statusText}
        </div>
      </div>
    </div>
  )
}
