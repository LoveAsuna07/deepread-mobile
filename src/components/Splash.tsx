import { useEffect, useRef, useState } from 'react'
import { SPLASH_CHARS } from '../lib/splashStrokes'

/** 写字总时长（不含停顿），毫秒 */
const WRITE_MS = 1600
/** 同一个字里两笔之间提笔的停顿 */
const PEN_LIFT_MS = 40
/** 两个字之间的停顿 */
const CHAR_GAP_MS = 150
/** 写完后停一下再淡出 */
const HOLD_MS = 350
const FADE_MS = 450
/** 揭开笔画用的“笔”的粗细（1024 网格单位），要比最粗的笔画还宽 */
const PEN_W = 200
const CHAR_ADVANCE = 980

function medianLength(pts: [number, number][]) {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return Math.max(len, 1)
}

const STROKES = SPLASH_CHARS.flatMap((c, ci) =>
  c.medians.map((m, si) => ({
    key: `${ci}-${si}`,
    ci,
    si,
    outline: c.strokes[si],
    median: `M ${m.map(([x, y]) => `${x} ${y}`).join(' L ')}`,
    len: medianLength(m),
  })),
)

function plan() {
  const gaps = STROKES.reduce((sum, s, i) => (i === 0 ? sum : sum + (s.ci !== STROKES[i - 1].ci ? CHAR_GAP_MS : PEN_LIFT_MS)), 0)
  const total = STROKES.reduce((sum, s) => sum + s.len, 0)
  const msPerUnit = (WRITE_MS - gaps) / total
  let t = 0
  return STROKES.map((s, i) => {
    if (i > 0) t += s.ci !== STROKES[i - 1].ci ? CHAR_GAP_MS : PEN_LIFT_MS
    const delay = t
    const duration = Math.max(70, s.len * msPerUnit)
    t += duration
    return { delay, duration, end: t }
  })
}

function shouldPlay() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  // 在后台打开（比如预加载）就不播了
  if (document.visibilityState === 'hidden') return false
  return true
}

/**
 * 开场动画：像用笔一样按笔顺写出“深读”，写完淡出露出书架。
 * 每次打开都播，点屏幕任意处跳过；系统开了“减少动态效果”就不播。
 */
export default function Splash() {
  const [show, setShow] = useState(shouldPlay)
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const anims = useRef<Animation[]>([])
  const leaving = useRef(false)

  useEffect(() => {
    if (!show) return
    const root = rootRef.current
    const svg = svgRef.current
    if (!root || !svg || typeof root.animate !== 'function') {
      setShow(false)
      return
    }
    const timing = plan()
    const pens = Array.from(svg.querySelectorAll<SVGPathElement>('[data-pen]'))
    anims.current = pens.map((pen, i) => {
      const s = STROKES[i]
      // 笔头是圆的，会比路径起点多出半个笔宽，起点要再往前藏一点
      const start = 1 + PEN_W / 2 / s.len + 0.02
      return pen.animate([{ strokeDashoffset: start }, { strokeDashoffset: 0 }], {
        delay: timing[i].delay,
        duration: timing[i].duration,
        easing: 'cubic-bezier(.45,.05,.55,.95)',
        fill: 'both',
      })
    })
    const writeEnd = timing[timing.length - 1]?.end ?? 0
    // 开发时地址加 ?splash-hold 可以停住不淡出，方便逐帧检查
    const hold = import.meta.env.DEV && location.search.includes('splash-hold')
    const timer = hold ? 0 : window.setTimeout(() => leave(FADE_MS), writeEnd + HOLD_MS)
    return () => {
      window.clearTimeout(timer)
      anims.current.forEach((a) => a.cancel())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  function leave(ms: number) {
    const root = rootRef.current
    if (!root || leaving.current) return
    leaving.current = true
    const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' })
    fade.onfinish = () => setShow(false)
  }

  if (!show) return null

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--color-paper)]"
      aria-hidden="true"
      onPointerDown={() => {
        // 点一下跳过：字直接写完，快速淡出
        anims.current.forEach((a) => a.finish())
        leave(220)
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHAR_ADVANCE + 1024} 1024`}
        className="-mt-[8vh] w-[min(62vw,300px)] overflow-visible"
        role="presentation"
      >
        <defs>
          {STROKES.map((s) => (
            <clipPath key={s.key} id={`dr-splash-${s.key}`}>
              <path d={s.outline} />
            </clipPath>
          ))}
        </defs>
        {SPLASH_CHARS.map((c, ci) => (
          <g key={c.char} transform={`translate(${ci * CHAR_ADVANCE}, 900) scale(1, -1)`}>
            {STROKES.filter((s) => s.ci === ci).map((s) => (
              <path
                key={s.key}
                data-pen=""
                d={s.median}
                pathLength={1}
                clipPath={`url(#dr-splash-${s.key})`}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth={PEN_W}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="1 3"
                strokeDashoffset={1 + PEN_W / 2 / s.len + 0.02}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}
