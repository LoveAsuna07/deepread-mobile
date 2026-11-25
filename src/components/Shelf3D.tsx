import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
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
const hover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

/**
 * 一排白色薄活页夹。默认都立在架上；
 * 鼠标悬停（电脑）或第一次点（手机）时抽出一半，再点一次打开。
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
  const [fit, setFit] = useState({ s: 1, dx: 0, h: 380 })
  const leaveTimer = useRef(0)

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

  // 3D 投影后的实际范围不好算，渲染后量一下所有书（不含抽出的那本），再缩放居中
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
      const s = Math.min(1, Math.max(0.4, (sr.width - 24) / w))
      const center = sr.left + sr.width / 2
      const dx = -((l - extra + r) / 2 - center) * s
      row.style.setProperty('--s', String(s))
      row.style.setProperty('--dx', `${dx}px`)
      setFit({ s, dx, h: Math.round(h * s + bookH * 0.22 * s + 56) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [rowW, items.length])

  function tap(item: ShelfItem) {
    if (hover || peekId === item.id) onOpen(item)
    else onPeek(item.id)
  }

  return (
    <div className="dr-shelf">
      <div
        ref={stageRef}
        className="dr-shelf-stage"
        style={{ height: fit.h }}
        onClick={(e) => {
          // 3D 变换下点击可能落在背景上，按坐标再找一次书
          const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-book]')
          const item = items.find((it) => it.id === el?.dataset.book)
          if (item) tap(item)
          else if (!hover) onPeek(null)
        }}
      >
        <div
          ref={rowRef}
          className="dr-shelf-row"
          style={{ width: rowW, marginLeft: -rowW / 2, '--s': fit.s, '--dx': `${fit.dx}px` } as CSSProperties}
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
                if (!hover || !item) return
                window.clearTimeout(leaveTimer.current)
                onPeek(item.id)
              }}
              onMouseLeave={() => {
                if (!hover || !item) return
                window.clearTimeout(leaveTimer.current)
                leaveTimer.current = window.setTimeout(() => onPeek(null), 120)
              }}
              onFocus={() => item && onPeek(item.id)}
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
