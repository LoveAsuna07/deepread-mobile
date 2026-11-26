import { useEffect, useRef, useState } from 'react'

/*
 * 开场动画：屏幕中间先冒出一颗玻璃水珠，水珠拉成一根粗细均匀的玻璃管，
 * 用连笔手写体写出 “deep read”，写完停一下，整屏淡出露出书架。
 * 字形是自己画的单线连笔（不是任何字体），坐标里 y 向下，基线在 300，小写字母高度 210–300。
 */

type Seg = [number, number, number, number, number, number]
interface Glyph {
  /** 从上一个字母接过来时的起点（基线附近） */
  join: [number, number]
  /** 单独作为词首时的起点 */
  start: [number, number]
  /** 词首时跳过的接笔段数 */
  skip: number
  segs: Seg[]
  width: number
}

// 每个字母在自己的坐标系里，从 (0, 290) 附近接笔进来，到 (width, 288) 附近出笔
const GLYPHS: Record<string, Glyph> = {
  d: {
    join: [0, 290],
    start: [54, 222],
    skip: 1,
    segs: [
      [20, 278, 44, 238, 54, 222],
      [34, 206, 2, 226, 4, 262],
      [6, 298, 42, 306, 57, 279],
      [63, 262, 67, 178, 71, 108],
      [67, 178, 63, 262, 57, 279],
      [60, 302, 90, 300, 100, 289],
    ],
    width: 100,
  },
  e: {
    join: [0, 289],
    start: [4, 280],
    skip: 0,
    segs: [
      [14, 282, 42, 268, 44, 248],
      [46, 230, 28, 222, 17, 236],
      [5, 252, 8, 290, 29, 298],
      [43, 304, 56, 296, 64, 288],
    ],
    width: 64,
  },
  p: {
    join: [0, 288],
    start: [6, 260],
    skip: 0,
    segs: [
      [10, 272, 18, 240, 21, 212],
      [22, 262, 19, 330, 16, 392],
      [19, 330, 22, 262, 21, 212],
      [36, 200, 72, 206, 73, 242],
      [74, 276, 48, 304, 22, 292],
      [46, 304, 70, 298, 84, 287],
    ],
    width: 84,
  },
  r: {
    join: [0, 289],
    start: [2, 262],
    skip: 0,
    segs: [
      [8, 272, 15, 238, 18, 213],
      [22, 226, 32, 230, 40, 224],
      [47, 218, 50, 212, 54, 216],
      [60, 238, 56, 270, 60, 288],
      [64, 298, 74, 296, 82, 288],
    ],
    width: 82,
  },
  a: {
    join: [0, 289],
    start: [52, 222],
    skip: 1,
    segs: [
      [18, 276, 40, 238, 52, 222],
      [33, 205, 2, 226, 4, 262],
      [6, 297, 41, 305, 55, 280],
      [59, 266, 61, 238, 61, 214],
      [61, 238, 59, 266, 56, 282],
      [58, 302, 80, 298, 90, 288],
    ],
    width: 90,
  },
}

const WORD_GAP = 46

/** 把一个词拼成一条连笔路径，返回路径和词宽 */
function wordPath(word: string, x0: number) {
  let x = x0
  let d = ''
  ;[...word].forEach((ch, i) => {
    const g = GLYPHS[ch]
    const segs = i === 0 ? g.segs.slice(g.skip) : g.segs
    if (i === 0) d += `M ${x + g.start[0]} ${g.start[1]}`
    for (const s of segs) d += ` C ${x + s[0]} ${s[1]} ${x + s[2]} ${s[3]} ${x + s[4]} ${s[5]}`
    x += g.width
  })
  return { d, end: x }
}

const W1 = wordPath('deep', 0)
const W2 = wordPath('read', W1.end + WORD_GAP)
const WORDS = [W1.d, W2.d]
const TEXT_W = W2.end
const VIEW = { x: -30, y: 70, w: TEXT_W + 60, h: 360 }
const START = { x: GLYPHS.d.start[0], y: GLYPHS.d.start[1] }

/** 玻璃管的粗细（路径坐标单位） */
const TUBE = 21
const DROP_MS = 950
const WRITE_MS = 2000
const LIFT_MS = 160
const HOLD_MS = 550
const FADE_MS = 550

function shouldPlay() {
  if (typeof window === 'undefined') return false
  if (import.meta.env.DEV && location.search.includes('splash-hold')) return true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (document.visibilityState === 'hidden') return false
  return true
}

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
    const list: Animation[] = []

    // 1. 水珠：在屏幕正中冒出来，弹一下，再滑到第一笔的起点
    const drop = svg.querySelector<SVGGElement>('[data-drop]')!
    const c = `translate(${TEXT_W / 2 - START.x}px, ${255 - START.y}px)`
    list.push(
      drop.animate(
        [
          { transform: `${c} scale(0)`, opacity: 0 },
          { transform: `${c} scale(1.18)`, opacity: 1, offset: 0.35 },
          { transform: `${c} scale(1)`, opacity: 1, offset: 0.55 },
          { transform: 'translate(0px, 0px) scale(0.9)', opacity: 1 },
        ],
        { duration: DROP_MS, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'both' },
      ),
    )
    // 写字开始后水珠缩成笔头
    list.push(
      drop.animate([{ transform: 'scale(0.9)', opacity: 1 }, { transform: 'scale(.45)', opacity: 0 }], {
        delay: DROP_MS,
        duration: 260,
        easing: 'ease-in',
        fill: 'forwards',
      }),
    )

    // 2. 两个词按长度分配时间，同一个词的几层（阴影、管身、高光）一起走
    const lens = WORDS.map((_, wi) => svg.querySelector<SVGPathElement>(`[data-word="${wi}"]`)!.getTotalLength())
    const total = lens[0] + lens[1]
    let t = DROP_MS - 60
    WORDS.forEach((_, wi) => {
      const duration = ((WRITE_MS - LIFT_MS) * lens[wi]) / total
      // 圆头会比起点多出半个管宽，起点再往前藏一点，免得提前露出一个点
      const hide = 1 + TUBE / lens[wi]
      for (const el of Array.from(svg.querySelectorAll<SVGPathElement>(`[data-word="${wi}"]`))) {
        list.push(
          el.animate([{ strokeDashoffset: hide }, { strokeDashoffset: 0 }], {
            delay: t,
            duration,
            easing: 'cubic-bezier(.35,.1,.45,1)',
            fill: 'both',
          }),
        )
      }
      t += duration + LIFT_MS
    })
    const writeEnd = t - LIFT_MS

    // 3. 写完字整体轻轻浮一下，像玻璃在光里
    const word = svg.querySelector<SVGGElement>('[data-words]')!
    list.push(
      word.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }], {
        delay: writeEnd,
        duration: HOLD_MS + FADE_MS,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    )
    anims.current = list

    const hold = import.meta.env.DEV && location.search.includes('splash-hold')
    const timer = hold ? 0 : window.setTimeout(() => leave(FADE_MS), writeEnd + HOLD_MS)
    return () => {
      window.clearTimeout(timer)
      list.forEach((a) => a.cancel())
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

  const dash = { pathLength: 1, strokeDasharray: '1 3', strokeDashoffset: 2 } as const

  return (
    <div
      ref={rootRef}
      className="dr-splash fixed inset-0 z-[60] flex items-center justify-center"
      aria-hidden="true"
      onPointerDown={() => {
        anims.current.forEach((a) => a.finish())
        leave(240)
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
        className="-mt-[6vh] w-[min(78vw,380px)] overflow-visible"
        role="presentation"
      >
        <defs>
          <linearGradient id="dr-glass" x1="0" y1="200" x2="0" y2="320" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#e4ebff" stopOpacity="0.78" />
            <stop offset="1" stopColor="#c9d5ff" stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id="dr-drop" cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="0.45" stopColor="#eef2ff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#b9c8ff" stopOpacity="0.75" />
          </radialGradient>
          <filter id="dr-soft" x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <g data-drop="" style={{ transformOrigin: `${START.x}px ${START.y}px`, transformBox: 'view-box' }}>
          <circle cx={START.x + 2} cy={START.y + 8} r={TUBE * 1.5} fill="#2c3fb8" opacity="0.22" filter="url(#dr-soft)" />
          <circle cx={START.x} cy={START.y} r={TUBE * 1.35} fill="url(#dr-drop)" />
          <ellipse cx={START.x - 6} cy={START.y - 8} rx={TUBE * 0.5} ry={TUBE * 0.3} fill="#fff" opacity="0.9" />
        </g>

        <g data-words="" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {WORDS.map((d, wi) => (
            <g key={wi}>
              {/* 阴影：让玻璃管浮在背景上 */}
              <path
                data-word={wi}
                d={d}
                transform="translate(2 9)"
                stroke="#2238b0"
                strokeOpacity="0.28"
                strokeWidth={TUBE + 6}
                filter="url(#dr-soft)"
                {...dash}
              />
              {/* 管身 */}
              <path data-word={wi} d={d} stroke="url(#dr-glass)" strokeWidth={TUBE} {...dash} />
              {/* 右下内侧一道暗边，显出圆管的厚度 */}
              <path
                data-word={wi}
                d={d}
                transform={`translate(${TUBE * 0.14} ${TUBE * 0.17})`}
                stroke="#7f95f2"
                strokeOpacity="0.32"
                strokeWidth={TUBE * 0.42}
                {...dash}
              />
              {/* 高光 */}
              <path
                data-word={wi}
                d={d}
                transform={`translate(${-TUBE * 0.16} ${-TUBE * 0.2})`}
                stroke="#ffffff"
                strokeOpacity="0.95"
                strokeWidth={TUBE * 0.26}
                {...dash}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
