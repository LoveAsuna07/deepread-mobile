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
  /** 出笔停在字母上半部（像 r 的肩），下一个字母要从高处接 */
  exitHigh?: boolean
  /** 上一个字母从高处出笔时，用这几段换掉自己的第一段接笔 */
  highJoin?: Seg[]
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
    highJoin: [
      [8, 238, 8, 256, 14, 263],
      [24, 270, 42, 263, 44, 248],
    ],
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
    start: [0, 278],
    skip: 0,
    segs: [
      [6, 262, 12, 236, 15, 212],
      [15, 240, 14, 268, 14, 293],
      [14, 268, 15, 248, 19, 236],
      [27, 214, 46, 206, 58, 216],
      [63, 220, 66, 226, 68, 233],
    ],
    width: 68,
    exitHigh: true,
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
    const prev = i > 0 ? GLYPHS[word[i - 1]] : null
    const segs =
      i === 0 ? g.segs.slice(g.skip) : prev?.exitHigh && g.highJoin ? [...g.highJoin, ...g.segs.slice(1)] : g.segs
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
const TUBE = 19
const DROP_MS = 1150
const WRITE_MS = 3300
const LIFT_MS = 240
const HOLD_MS = 700
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
          // 每一段自己的缓动：冒出来带一点回弹，停一下，再顺滑地滑过去
          { transform: `${c} scale(0)`, opacity: 0, easing: 'cubic-bezier(.3,.7,.4,1)' },
          { transform: `${c} scale(1.18)`, opacity: 1, offset: 0.3, easing: 'ease-out' },
          { transform: `${c} scale(1)`, opacity: 1, offset: 0.42 },
          { transform: `${c} scale(1)`, opacity: 1, offset: 0.55, easing: 'cubic-bezier(.55,0,.25,1)' },
          { transform: 'translate(0px, 0px) scale(0.9)', opacity: 1 },
        ],
        { duration: DROP_MS, fill: 'both' },
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
    // 浏览器会自动丢掉已播完、又被后面动画覆盖的动画；留着它们，跳过和逐帧检查时才准
    list.forEach((a) => a.persist?.())
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
          <filter id="dr-soft" x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="dr-caustic" x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
          {/*
            玻璃材质：拿笔画的形状当高度图，
            - 管身几乎透明，只蒙一层很淡的白
            - 边缘一圈偏暗（真玻璃边上折射最强，看起来是一圈深色轮廓）
            - 用镜面光照打出左上方的亮面
          */}
          <filter
            id="dr-glass"
            filterUnits="userSpaceOnUse"
            x={VIEW.x - 60}
            y={VIEW.y - 60}
            width={VIEW.w + 120}
            height={VIEW.h + 120}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation={TUBE * 0.17} result="bump" />
            <feSpecularLighting
              in="bump"
              surfaceScale={TUBE * 0.3}
              specularConstant="1.6"
              specularExponent="34"
              lightingColor="#ffffff"
              result="spec"
            >
              <feDistantLight azimuth="235" elevation="52" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />

            <feMorphology in="SourceAlpha" operator="erode" radius={TUBE * 0.13} result="core" />
            <feGaussianBlur in="core" stdDeviation={TUBE * 0.06} result="coreSoft" />
            <feComposite in="SourceAlpha" in2="coreSoft" operator="out" result="rim" />
            <feFlood floodColor="#34403b" floodOpacity="0.62" />
            <feComposite in2="rim" operator="in" result="rimTint" />

            <feFlood floodColor="#ffffff" floodOpacity="0.16" />
            <feComposite in2="SourceAlpha" operator="in" result="body" />

            <feMerge>
              <feMergeNode in="body" />
              <feMergeNode in="rimTint" />
              <feMergeNode in="specIn" />
            </feMerge>
          </filter>
        </defs>

        <g data-drop="" style={{ transformOrigin: `${START.x}px ${START.y}px`, transformBox: 'view-box' }}>
          <circle cx={START.x + 3} cy={START.y + 12} r={TUBE * 1.3} fill="#1f1e1b" opacity="0.17" filter="url(#dr-soft)" />
          <circle cx={START.x + 2} cy={START.y + 10} r={TUBE * 0.6} fill="#fffaf0" opacity="0.9" filter="url(#dr-caustic)" />
          <circle cx={START.x} cy={START.y} r={TUBE * 1.35} fill="#000" filter="url(#dr-glass)" />
          <ellipse cx={START.x - 7} cy={START.y - 9} rx={TUBE * 0.42} ry={TUBE * 0.24} fill="#fff" opacity="0.85" />
        </g>

        <g data-words="" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {WORDS.map((d, wi) => (
            <g key={wi}>
              {/* 落在纸上的影子 */}
              <path
                data-word={wi}
                d={d}
                transform="translate(3 11)"
                stroke="#1f1e1b"
                strokeOpacity="0.17"
                strokeWidth={TUBE + 4}
                filter="url(#dr-soft)"
                {...dash}
              />
              {/* 影子里一道被玻璃聚起来的亮光 */}
              <path
                data-word={wi}
                d={d}
                transform="translate(2 9)"
                stroke="#fffaf0"
                strokeOpacity="0.9"
                strokeWidth={TUBE * 0.35}
                filter="url(#dr-caustic)"
                {...dash}
              />
              {/* 玻璃管本身 */}
              <path data-word={wi} d={d} stroke="#000" strokeWidth={TUBE} filter="url(#dr-glass)" {...dash} />
              {/* 一道细长的高光，让玻璃更清透 */}
              <path
                data-word={wi}
                d={d}
                transform={`translate(${-TUBE * 0.18} ${-TUBE * 0.22})`}
                stroke="#ffffff"
                strokeOpacity="0.75"
                strokeWidth={TUBE * 0.12}
                {...dash}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
