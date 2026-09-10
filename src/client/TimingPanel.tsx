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

export function TimingPanel({
  stats,
  scope,
  tokensPerSecond,
}: {
  stats: InsightsView['totals']
  scope: 'turn' | 'session'
  tokensPerSecond?: number | null
}) {
  const [hoverType, setHoverType] = useState<'model' | 'tool' | null>(null)
  const [popoverLeft, setPopoverLeft] = useState<number>(0)
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
    statusText = `⚠ ${stats.toolErrors} 报错 · ${stats.retries} 次重试`
    statusClass = css.statusDanger
  } else if (hasError) {
    statusText = `⚠ ${stats.toolErrors} 次工具报错`
    statusClass = css.statusDanger
  } else if (hasRetry) {
    statusText = `⚠ ${stats.retries} 次网络重试排队`
    statusClass = css.statusWarn
  }

  const handleSliceHover = (type: 'model' | 'tool', e: React.MouseEvent<HTMLElement>) => {
    setHoverType(type)
    if (chartBoxRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      const parentRect = chartBoxRef.current.getBoundingClientRect()
      const left = rect.left - parentRect.left + (rect.width / 2) - 120
      setPopoverLeft(Math.max(8, Math.min(parentRect.width - 248, left)))
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
          {/* 1. 模型大类（占 modelPct） */}
          <div
            className={css.modelCluster}
            style={{ width: `${modelPct}%` }}
            onMouseEnter={e => handleSliceHover('model', e)}
            onMouseLeave={() => setHoverType(null)}
          >
            {/* 首字等待 (冷雾灰蓝) */}
            {ttftSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceTtft}`}
                style={{ width: `${ttftSubPct}%` }}
              />
            ) : null}
            {/* 深度思考 (DeepSeek深蓝) */}
            {thinkSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceThink}`}
                style={{ width: `${thinkSubPct}%` }}
              />
            ) : null}
            {/* 正文输出 (明亮天蓝) */}
            {outputSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceOutput}`}
                style={{ width: `${outputSubPct}%` }}
              />
            ) : null}
          </div>

          {/* 2. 工具大类（占 toolPct） */}
          <div
            className={css.toolCluster}
            style={{ width: `${toolPct}%` }}
            onMouseEnter={e => handleSliceHover('tool', e)}
            onMouseLeave={() => setHoverType(null)}
          >
            {/* 终端执行 (深翠绿) */}
            {bashSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceBash}`}
                style={{ width: `${bashSubPct}%` }}
              />
            ) : null}
            {/* 文件及其他读写 (薄荷浅绿) */}
            {fileSubPct > 0 ? (
              <div
                className={`${css.slice} ${css.sliceFile}`}
                style={{ width: `${fileSubPct}%` }}
              />
            ) : null}
          </div>
        </div>

        {/* 悬停专业分析浮层 */}
        {hoverType ? (
          <div className={css.popover} style={{ left: `${popoverLeft}px` }}>
            <div className={css.popTitle}>
              <span>{hoverType === 'model' ? '模型请求各阶段拆解' : '工具执行耗时排行'}</span>
              <span>{hoverType === 'model' ? `${duration(modelTotalMs)} (${Math.round(modelPct)}%)` : `${duration(toolTotalMs)} (${Math.round(toolPct)}%)`}</span>
            </div>
            <div className={css.popList}>
              {hoverType === 'model' ? (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-think)' }} />
                      <span>可见深度推导</span>
                    </div>
                    <span className={`${css.popRight} ${thinkMs >= ttftMs && thinkMs >= outputMs && thinkMs > 0 ? css.activeVal : ''}`}>
                      {duration(thinkMs)} ({ttftSubPct + thinkSubPct + outputSubPct > 0 ? Math.round((thinkMs / modelTotalMs) * 100) : 0}%)
                    </span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-ttft)' }} />
                      <span>{ttftLabel}</span>
                    </div>
                    <span className={`${css.popRight} ${ttftMs > thinkMs && ttftMs > outputMs ? css.activeVal : ''}`}>
                      {duration(ttftMs)} ({ttftSubPct}%)
                    </span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-output)' }} />
                      <span>正文与代码生成</span>
                    </div>
                    <span className={`${css.popRight} ${outputMs > thinkMs && outputMs > ttftMs ? css.activeVal : ''}`}>
                      {duration(outputMs)} ({outputSubPct}%)
                    </span>
                  </div>
                  {stats.reasoning ? (
                    <div className={css.popRow} style={{ borderTop: '1px dashed rgba(255,255,255,0.15)', marginTop: '4px', paddingTop: '4px' }}>
                      <div className={css.popLeft}>
                        <i className={css.dot} style={{ background: 'var(--c-think)' }} />
                        <span>思考消耗 Token</span>
                      </div>
                      <span className={css.popRight}>
                        {fmtNum(stats.reasoning)} ({stats.output > 0 ? Math.round((stats.reasoning / stats.output) * 100) : 0}% 输出)
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-bash)' }} />
                      <span>终端命令 bash</span>
                    </div>
                    <span className={`${css.popRight} ${bashMs >= fileMs && bashMs > 0 ? css.activeVal : ''}`}>
                      {duration(bashMs)} ({bashSubPct}%)
                    </span>
                  </div>
                  <div className={css.popRow}>
                    <div className={css.popLeft}>
                      <i className={css.dot} style={{ background: 'var(--c-file)' }} />
                      <span>文件读写与其它</span>
                    </div>
                    <span className={`${css.popRight} ${fileMs > bashMs ? css.activeVal : ''}`}>
                      {duration(fileMs)} ({fileSubPct}%)
                    </span>
                  </div>
                  <div className={css.popRow} style={{ borderTop: '1px dashed rgba(255,255,255,0.15)', marginTop: '4px', paddingTop: '4px' }}>
                    <div className={css.popLeft}>
                      <span>总计执行次数</span>
                    </div>
                    <span className={css.popRight}>
                      {stats.tools} 次 ({stats.toolErrors > 0 ? `${stats.toolErrors} 次报错` : '全部成功'})
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* 底行：图例呼应 + 暗病警报胶囊 */}
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

        {/* 状态胶囊（一眼扫清重试或报错） */}
        <div className={`${css.statusPill} ${statusClass}`}>
          {statusText}
        </div>
      </div>
    </div>
  )
}
