import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { blobUrl } from '../lib/db'
import type { Annotation, AnnotationLoc, Chapter } from '../lib/types'
import type { Box } from './useBoxSelect'
import type { Draft, ViewHandle, ViewProps } from './types'

interface Props extends ViewProps {
  chapters: Chapter[]
  chapter: number
  initialOffset: number
  onChapter: (index: number) => void
  fontSize: number
  lineHeight: number
  fontFamily: string
  margin: number
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, img, td, th, dt, dd'
/** 同时挂在页面上的章节数，多了就从另一头卸掉 */
const KEEP = 5

function blocksOf(root: HTMLElement): HTMLElement[] {
  // 只保留最内层的块，避免 li 里套 p 时重复
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SEL))
  return all.filter((el) => !el.querySelector(BLOCK_SEL))
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}

/** 元素在滚动内容里的 y（和当前滚到哪无关） */
function topIn(el: HTMLElement, node: HTMLElement) {
  return el.scrollTop + node.getBoundingClientRect().top - el.getBoundingClientRect().top
}

/**
 * 上下连续阅读：读到章末继续往下滑就是下一章，往上滑到章首就接上一章。
 * 页面上同时挂着相邻的几章，当前章 = 视口 30% 高度处所在的那章。
 */
const TextView = forwardRef<ViewHandle, Props>(function TextView(
  {
    chapters,
    chapter,
    initialOffset,
    onChapter,
    fontSize,
    lineHeight,
    fontFamily,
    margin,
    scrollRef,
    annotations,
    onOpenAnnotation,
    onProgress,
    onLabel,
  },
  ref,
) {
  const [win, setWin] = useState({ from: chapter, to: chapter })
  const articles = useRef(new Map<number, HTMLElement>())
  /** 自己报给外面的当前章；外面传进来的 chapter 和它不同，说明是目录跳转 */
  const reported = useRef(chapter)
  const pendingJump = useRef<{ chapter: number; block: number; offsetY: number; flash: boolean } | null>(null)
  const pendingOffset = useRef<number | null>(initialOffset)
  /** 加载相邻章节前记下当前章的位置，加载后把滚动位置补回来，画面不跳 */
  const anchor = useRef<{ chapter: number; top: number } | null>(null)
  const positioned = useRef(false)
  const growing = useRef(false)
  const n = chapters.length

  // 目录跳转等外部换章：只留那一章，从头读
  useEffect(() => {
    if (chapter === reported.current) return
    reported.current = chapter
    pendingOffset.current = 0
    positioned.current = false
    setWin({ from: chapter, to: chapter })
  }, [chapter])

  function scrollToBlock(jump: { chapter: number; block: number; offsetY: number; flash: boolean }) {
    const el = scrollRef.current
    const art = articles.current.get(jump.chapter)
    if (!el || !art) return false
    const block = blocksOf(art)[jump.block]
    if (!block) return false
    const r = block.getBoundingClientRect()
    el.scrollTo({ top: Math.max(0, topIn(el, block) + r.height * jump.offsetY - el.clientHeight * 0.3) })
    if (jump.flash) {
      block.classList.add('is-flash')
      window.setTimeout(() => block.classList.remove('is-flash'), 2600)
    }
    return true
  }

  // 章节挂上去之后：换图片地址、定位
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    for (const art of articles.current.values()) {
      for (const img of Array.from(art.querySelectorAll<HTMLImageElement>('img[src^="dr-blob:"]'))) {
        const id = img.getAttribute('src')!.slice('dr-blob:'.length)
        img.removeAttribute('src')
        img.dataset.blob = id
        void blobUrl(id).then((u) => {
          if (u) img.src = u
        })
      }
    }
    growing.current = false
    const jump = pendingJump.current
    const offset = pendingOffset.current
    const a = anchor.current
    pendingJump.current = null
    pendingOffset.current = null
    anchor.current = null
    if (jump) {
      scrollToBlock(jump)
      positioned.current = true
    } else if (offset !== null) {
      const art = articles.current.get(win.from)
      const place = () => {
        if (art) el.scrollTop = topIn(el, art) + offset * Math.max(0, art.offsetHeight - el.clientHeight)
        positioned.current = true
      }
      if (offset > 0) requestAnimationFrame(place)
      else place()
    } else if (a) {
      const art = articles.current.get(a.chapter)
      if (art) el.scrollTop += topIn(el, art) - a.top
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, scrollRef])

  // 批注标记
  useEffect(() => {
    for (const [ch, art] of articles.current) {
      const blocks = blocksOf(art)
      blocks.forEach((b) => {
        b.classList.remove('is-annotated')
        delete b.dataset.ann
      })
      for (const a of annotations) {
        if (a.loc.kind !== 'text' || a.loc.chapter !== ch) continue
        const b = blocks[a.loc.block]
        if (!b || b.dataset.ann) continue
        b.classList.add('is-annotated')
        b.dataset.ann = a.id
      }
    }
  }, [annotations, win])

  // 滚动：算当前章和进度，快到头尾时接上相邻章节
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const box = el.getBoundingClientRect()
      const probe = box.top + el.clientHeight * 0.3
      let cur = win.from
      let rect: DOMRect | null = null
      for (let i = win.from; i <= win.to; i++) {
        const art = articles.current.get(i)
        if (!art) continue
        const r = art.getBoundingClientRect()
        if (r.top <= probe || !rect) {
          cur = i
          rect = r
        }
      }
      const offset = rect ? Math.min(1, Math.max(0, (box.top - rect.top) / Math.max(1, rect.height - el.clientHeight))) : 0
      if (cur !== reported.current) {
        reported.current = cur
        onChapter(cur)
      }
      onProgress(cur, offset, n > 0 ? Math.min(1, (cur + offset) / n) : 0)
      onLabel(`${cur + 1} / ${n}`)

      if (!positioned.current || growing.current) return
      const curArt = articles.current.get(cur)
      if (!curArt) return
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 1.5
      const nearTop = el.scrollTop < el.clientHeight * 0.6
      if (nearBottom && win.to < n - 1) {
        growing.current = true
        anchor.current = { chapter: cur, top: topIn(el, curArt) }
        const to = win.to + 1
        setWin({ from: Math.min(cur, Math.max(win.from, to - KEEP + 1)), to })
      } else if (nearTop && win.from > 0) {
        growing.current = true
        anchor.current = { chapter: cur, top: topIn(el, curArt) }
        const from = win.from - 1
        setWin({ from, to: Math.max(cur, Math.min(win.to, from + KEEP - 1)) })
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, win, n, onChapter, onProgress, onLabel])

  useImperativeHandle(
    ref,
    () => ({
      async resolveBox(box: Box): Promise<Draft | null> {
        type Hit = { b: HTMLElement; i: number; ch: number; r: DOMRect }
        let hit: Hit[] = []
        for (const [ch, art] of articles.current) {
          blocksOf(art).forEach((b, i) => {
            const r = b.getBoundingClientRect()
            if (r.bottom > box.top && r.top < box.top + box.height && r.right > box.left && r.left < box.left + box.width)
              hit.push({ b, i, ch, r })
          })
        }
        if (hit.length === 0) return null
        hit.sort((x, y) => x.r.top - y.r.top)
        // 框跨了两章时只取上面那章
        const ch = hit[0].ch
        hit = hit.filter((h) => h.ch === ch)
        const root = articles.current.get(ch)!
        // 先用框的两个角取一段连续文字；取不到再退回整块文字
        let quote = ''
        const a = caretAt(box.left + 1, box.top + 1)
        const b = caretAt(box.left + box.width - 1, box.top + box.height - 1)
        if (a && b && root.contains(a.node) && root.contains(b.node)) {
          const range = document.createRange()
          range.setStart(a.node, a.offset)
          range.setEnd(b.node, b.offset)
          if (!range.collapsed) quote = range.toString()
        }
        if (quote.replace(/\s/g, '').length < 2) quote = hit.map(({ b }) => b.textContent ?? '').join('\n')
        quote = quote.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
        const first = hit[0]
        const offsetY = Math.min(1, Math.max(0, (box.top - first.r.top) / Math.max(1, first.r.height)))
        const full = root.textContent ?? ''
        const at = Math.max(0, full.indexOf(quote.slice(0, 30)))
        const context = full.slice(Math.max(0, at - 3000), at + quote.length + 3000)
        if (!quote && !hit.some(({ b }) => b.tagName === 'IMG' || b.querySelector('img'))) return null
        return {
          loc: { kind: 'text', chapter: ch, block: first.i, offsetY },
          quote: quote || '（图片）',
          context,
          location: chapters[ch]?.title || `第 ${ch + 1} 节`,
        }
      },
      jumpTo(loc: AnnotationLoc, flash = true) {
        if (loc.kind !== 'text') return
        const jump = { chapter: loc.chapter, block: loc.block, offsetY: loc.offsetY, flash }
        if (scrollToBlock(jump)) return
        pendingJump.current = jump
        reported.current = loc.chapter
        positioned.current = false
        setWin({ from: loc.chapter, to: loc.chapter })
        onChapter(loc.chapter)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapters, onChapter],
  )

  const list: number[] = []
  for (let i = win.from; i <= win.to; i++) if (chapters[i]) list.push(i)
  if (list.length === 0) return null

  return (
    <div
      className="mx-auto max-w-[680px] pb-10 pt-4"
      style={{ paddingLeft: margin, paddingRight: margin, '--font-reading': fontFamily } as React.CSSProperties}
    >
      {list.map((i) => (
        <section key={i} data-chapter={i}>
          {i > win.from && (
            <div className="dr-chapter-gap" aria-hidden="true">
              <span />
              <span className="num">{i + 1}</span>
              <span />
            </div>
          )}
          <article
            ref={(node) => {
              if (node) articles.current.set(i, node)
              else articles.current.delete(i)
            }}
            className="dr-prose"
            style={{ '--fs': `${fontSize}px`, '--lh': lineHeight } as React.CSSProperties}
            onClick={(e) => {
              const ann = (e.target as HTMLElement).closest<HTMLElement>('[data-ann]')?.dataset.ann
              if (ann) {
                e.stopPropagation()
                onOpenAnnotation(ann)
              }
            }}
            dangerouslySetInnerHTML={{ __html: chapters[i].html }}
          />
        </section>
      ))}
      {win.to >= n - 1 && <p className="mt-12 text-center font-[var(--font-reading)] text-[14px] text-[var(--color-muted)]">全书完</p>}
    </div>
  )
})

export type { Annotation }
export default TextView
