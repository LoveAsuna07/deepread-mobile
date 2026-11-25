import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { pad2, pad3 } from '../lib/format'
import type { CoverColorId } from '../lib/types'
import { Cover } from './ui'

export interface ShelfItem {
  id: string
  kind: 'doc' | 'notebook'
  title: string
  sub: string
  tag: string
  color: CoverColorId
  coverBlobId?: string
  meta: string
}

const MIN_SLOTS = 8
/** 有鼠标悬停的设备（电脑）：整排缩放放下，悬停抽出、点击打开 */
export const SHELF_HOVER = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
/** 手机上书的缩放：不再为了塞下整排而缩小，放不下就用手指左右滑 */
const TOUCH_SCALE = 0.78
const DRAG_START = 8

/**
 * 一排白色薄活页夹。默认都立在架上。
 * 电脑：鼠标悬停抽出一半，点击打开。
 * 手机：点一下抽出一半（不会直接打开，打开用下方按钮）；手指左右滑动书架。
 */
export default function Shelf3D({
  items,
  peekId,
  onPeek,
  onOpen,
}: {
  items: ShelfItem[]
  peekId: string | null
  onPeek: (id: string | null) => void
  onOpen: (item: ShelfItem) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(380)
  const leaveTimer = useRef(0)
  /** 居中时的位移、可滑动的范围（屏幕像素）、当前滑动量 */
  const geo = useRef({ base: 0, max: 0, pan: 0 })
  const drag = useRef<{ x: number; y: number; pan: number; moved: boolean; t: number; v: number; lastX: number } | null>(null)
  const swallowClick = useRef(false)
  const fling = useRef(0)

  const bookH = 260
  const slots = Array.from({ length: Math.max(items.length, MIN_SLOTS) }, (_, i) => items[i] ?? null)
  const widths = slots.map((it, i) => Math.round(bookH / 11) + ((i * 37 + (it?.title.length ?? 1) * 11) % 5))
  const offsets: number[] = []
  let cursor = 0
  widths.forEach((w) => {
    offsets.push(cursor)
    cursor += w + Math.round(w * 0.85)
  })
  const rowW = cursor - Math.round(widths[widths.length - 1] * 0.85)

  const apply = () => {
    const row = rowRef.current
    if (!row) return
    const { base, max, pan } = geo.current
    // 超出两端时只跟一部分，像拉橡皮筋
    const over = pan > max ? pan - max : pan < -max ? pan + max : 0
    const shown = pan - over + over * 0.3
    row.style.setProperty('--dx', `${base + shown}px`)
  }

  // 3D 投影后的实际范围不好算，渲染后量一下所有书（不含抽出的那本），再定缩放和滑动范围
  useLayoutEffect(() => {
    const stage = stageRef.current
    const row = rowRef.current
    if (!stage || !row) return
    const measure = () => {
      row.style.setProperty('--s', '1')
      row.style.setProperty('--dx', '0px')
      const sr = stage.getBoundingClientRect()
      let l = Infinity
      let r = -Infinity
      let top = Infinity
      let bottom = -Infinity
      for (const face of Array.from(row.querySelectorAll<HTMLElement>('.dr-book:not(.is-peek) .dr-book-face'))) {
        const b = face.getBoundingClientRect()
        if (b.width === 0 && b.height === 0) continue
        l = Math.min(l, b.left)
        r = Math.max(r, b.right)
        top = Math.min(top, b.top)
        bottom = Math.max(bottom, b.bottom)
      }
      if (!Number.isFinite(l)) return
      // 左边留出抽出时封面转出来的位置
      const extra = bookH * 0.45
      const w = r - l + extra
      const h = bottom - top
      const avail = sr.width - 24
      const s = SHELF_HOVER ? Math.min(1, Math.max(0.4, avail / w)) : Math.min(1, TOUCH_SCALE, Math.max(0.4, sr.width / 420))
      const center = sr.left + sr.width / 2
      const base = -((l - extra + r) / 2 - center) * s
      const max = Math.max(0, (w * s - avail) / 2)
      // 记住离最左端滑了多远，范围变了（加书、转屏）也不会把书甩出屏幕；第一次停在最左边
      const fromLeft = Math.max(0, geo.current.max - geo.current.pan)
      const pan = Math.max(-max, max - fromLeft)
      geo.current = { base, max, pan }
      row.style.setProperty('--s', String(s))
      apply()
      setHeight(Math.round(h * s + bookH * 0.22 * s + 56))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [rowW, items.length])

  useEffect(() => () => cancelAnimationFrame(fling.current), [])

  // 手机上抽出的书如果在屏幕外，滑过去让它露出来
  useEffect(() => {
    if (SHELF_HOVER || !peekId) return
    const stage = stageRef.current
    const el = stage?.querySelector<HTMLElement>(`[data-book="${peekId}"] .dr-book-spine`)
    if (!stage || !el) return
    const sr = stage.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const margin = 90
    let shift = 0
    if (b.left < sr.left + margin) shift = sr.left + margin - b.left
    else if (b.right > sr.right - 24) shift = sr.right - 24 - b.right
    if (shift) animateTo(geo.current.pan + shift)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peekId])

  function animateTo(target: number) {
    cancelAnimationFrame(fling.current)
    const g = geo.current
    const to = Math.max(-g.max, Math.min(g.max, target))
    const from = g.pan
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 320)
      g.pan = from + (to - from) * (1 - (1 - k) ** 3)
      apply()
      if (k < 1) fling.current = requestAnimationFrame(step)
    }
    fling.current = requestAnimationFrame(step)
  }

  function release(v: number) {
    // 松手后按速度继续滑一段，再在两端弹回
    cancelAnimationFrame(fling.current)
    const g = geo.current
    let vel = v * 16
    const step = () => {
      g.pan += vel
      vel *= 0.92
      const out = g.pan > g.max || g.pan < -g.max
      if (out) vel *= 0.6
      apply()
      if (Math.abs(vel) > 0.4) fling.current = requestAnimationFrame(step)
      else if (out) animateTo(g.pan)
    }
    fling.current = requestAnimationFrame(step)
  }

  function bookAt(x: number, y: number) {
    // 3D 变换下点击可能落在背景上，按坐标再找一次书
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-book]')
    return items.find((it) => it.id === el?.dataset.book)
  }

  return (
    <div className="dr-shelf">
      <div
        ref={stageRef}
        className="dr-shelf-stage"
        style={{ height }}
        onPointerDown={(e) => {
          // 电脑上整排都放得下，不用拖；手机布局下手指和鼠标都能拖
          if (SHELF_HOVER) return
          cancelAnimationFrame(fling.current)
          drag.current = { x: e.clientX, y: e.clientY, pan: geo.current.pan, moved: false, t: e.timeStamp, v: 0, lastX: e.clientX }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (!d.moved) {
            if (Math.abs(dx) < DRAG_START) return
            // 竖着滑是在滚动页面，交给浏览器
            if (Math.abs(e.clientY - d.y) > Math.abs(dx)) {
              drag.current = null
              return
            }
            d.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          const dt = Math.max(1, e.timeStamp - d.t)
          d.v = (e.clientX - d.lastX) / dt
          d.lastX = e.clientX
          d.t = e.timeStamp
          geo.current.pan = d.pan + dx
          apply()
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (!d?.moved) return
          swallowClick.current = true
          window.setTimeout(() => (swallowClick.current = false), 50)
          release(d.v)
        }}
        onPointerCancel={() => {
          const d = drag.current
          drag.current = null
          if (d?.moved) animateTo(geo.current.pan)
        }}
        onClick={(e) => {
          if (swallowClick.current) return
          const item = bookAt(e.clientX, e.clientY)
          if (SHELF_HOVER) {
            if (item) onOpen(item)
            return
          }
          // 手机：点书只抽出来，点空白处放回去
          onPeek(item ? item.id : null)
        }}
      >
        <div
          ref={rowRef}
          className="dr-shelf-row"
          style={{ width: rowW, marginLeft: -rowW / 2 } as CSSProperties}
        >
          {slots.map((item, i) => (
            <div
              key={item?.id ?? `blank-${i}`}
              data-book={item?.id}
              role={item ? 'button' : undefined}
              tabIndex={item ? 0 : -1}
              aria-label={item ? `${pad2(i + 1)} ${item.title}` : undefined}
              className={`dr-book${item && item.id === peekId ? ' is-peek' : ''}${item?.kind === 'notebook' ? ' is-note' : ''}${item ? '' : ' is-blank'}`}
              style={{ width: widths[i], '--tx': `${offsets[i]}px`, '--i': i } as CSSProperties}
              onMouseEnter={() => {
                if (!SHELF_HOVER || !item) return
                window.clearTimeout(leaveTimer.current)
                onPeek(item.id)
              }}
              onMouseLeave={() => {
                if (!SHELF_HOVER || !item) return
                window.clearTimeout(leaveTimer.current)
                leaveTimer.current = window.setTimeout(() => onPeek(null), 120)
              }}
              onFocus={(e) => {
                // 只有键盘 Tab 过来才抽出；手指按下也会触发 focus，滑动时不能抽
                if (item && e.currentTarget.matches(':focus-visible')) onPeek(item.id)
              }}
              onKeyDown={(e) => {
                if (!item) return
                if (e.key === 'Enter') onOpen(item)
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const next = items[i + (e.key === 'ArrowRight' ? 1 : -1)]
                  if (next) document.querySelector<HTMLElement>(`[data-book="${next.id}"]`)?.focus()
                }
              }}
            >
              <div className="dr-book-face dr-book-spine">
                <span className="dr-book-no">{item ? pad2(i + 1) : ''}</span>
                <span className="dr-book-title">{item ? item.title.slice(0, 12) : ''}</span>
                <span className="dr-book-hole" />
              </div>
              <div className="dr-book-face dr-book-top" />
              <div className="dr-book-face dr-book-side">
                <div className="dr-book-side-top">
                  <span>NO.{pad3(i + 1)}</span>
                  <span>{item?.tag ?? ''}</span>
                </div>
                <div className="dr-book-art">
                  {item && (
                    <Cover
                      title={item.title}
                      sub={item.sub}
                      color={item.color}
                      blobId={item.coverBlobId}
                      className="absolute inset-0"
                      titleSize={13}
                    />
                  )}
                </div>
                <div className="dr-book-side-bottom">
                  <span>{item?.meta ?? ''}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
