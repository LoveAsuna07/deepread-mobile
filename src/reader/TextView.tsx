import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, img, td, th, dt, dd'

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

const TextView = forwardRef<ViewHandle, Props>(function TextView(
  { chapters, chapter, initialOffset, onChapter, fontSize, lineHeight, scrollRef, annotations, onOpenAnnotation, onProgress, onLabel },
  ref,
) {
  const articleRef = useRef<HTMLElement>(null)
  const pendingJump = useRef<{ block: number; offsetY: number; flash: boolean } | null>(null)
  const pendingOffset = useRef<number | null>(initialOffset)
  const [renderKey, setRenderKey] = useState(0)
  const current = chapters[chapter]

  // 章节内容渲染后：换图片地址、标出批注、处理跳转
  useLayoutEffect(() => {
    const root = articleRef.current
    const el = scrollRef.current
    if (!root || !el) return
    for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[src^="dr-blob:"]'))) {
      const id = img.getAttribute('src')!.slice('dr-blob:'.length)
      img.removeAttribute('src')
      img.dataset.blob = id
      void blobUrl(id).then((u) => {
        if (u) img.src = u
      })
    }
    const jump = pendingJump.current
    const offset = pendingOffset.current
    pendingJump.current = null
    pendingOffset.current = null
    if (jump) {
      const block = blocksOf(root)[jump.block]
      if (block) {
        const r = block.getBoundingClientRect()
        const target = el.scrollTop + r.top - el.getBoundingClientRect().top + r.height * jump.offsetY - el.clientHeight * 0.3
        el.scrollTo({ top: Math.max(0, target) })
        if (jump.flash) {
          block.classList.add('is-flash')
          window.setTimeout(() => block.classList.remove('is-flash'), 2600)
        }
      }
    } else if (offset !== null && offset > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = offset * Math.max(0, el.scrollHeight - el.clientHeight)
      })
    } else {
      el.scrollTop = 0
    }
  }, [chapter, renderKey, scrollRef])

  // 批注标记
  useEffect(() => {
    const root = articleRef.current
    if (!root) return
    const blocks = blocksOf(root)
    blocks.forEach((b) => {
      b.classList.remove('is-annotated')
      delete b.dataset.ann
    })
    for (const a of annotations) {
      if (a.loc.kind !== 'text' || a.loc.chapter !== chapter) continue
      const b = blocks[a.loc.block]
      if (!b || b.dataset.ann) continue
      b.classList.add('is-annotated')
      b.dataset.ann = a.id
    }
  }, [annotations, chapter, renderKey])

  // 进度
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const max = el.scrollHeight - el.clientHeight
      const offset = max > 0 ? el.scrollTop / max : 1
      const n = chapters.length
      onProgress(chapter, offset, n > 0 ? Math.min(1, (chapter + offset) / n) : 0)
      onLabel(`${chapter + 1} / ${n}`)
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
  }, [scrollRef, chapter, chapters.length, onProgress, onLabel])

  const goChapter = useCallback(
    (i: number) => {
      if (i < 0 || i >= chapters.length) return
      pendingOffset.current = 0
      onChapter(i)
    },
    [chapters.length, onChapter],
  )

  useImperativeHandle(
    ref,
    () => ({
      async resolveBox(box: Box): Promise<Draft | null> {
        const root = articleRef.current
        if (!root) return null
        const blocks = blocksOf(root)
        const hit = blocks
          .map((b, i) => ({ b, i, r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.bottom > box.top && r.top < box.top + box.height && r.right > box.left && r.left < box.left + box.width)
        if (hit.length === 0) return null
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
          loc: { kind: 'text', chapter, block: first.i, offsetY },
          quote: quote || '（图片）',
          context,
          location: current?.title || `第 ${chapter + 1} 节`,
        }
      },
      jumpTo(loc: AnnotationLoc, flash = true) {
        if (loc.kind !== 'text') return
        pendingJump.current = { block: loc.block, offsetY: loc.offsetY, flash }
        if (loc.chapter === chapter) setRenderKey((k) => k + 1)
        else onChapter(loc.chapter)
      },
    }),
    [chapter, current, onChapter],
  )

  if (!current) return null
  return (
    <div className="mx-auto max-w-[680px] px-5 pb-10 pt-4">
      <article
        key={`${chapter}-${renderKey}`}
        ref={articleRef}
        className="dr-prose"
        style={{ '--fs': `${fontSize}px`, '--lh': lineHeight } as React.CSSProperties}
        onClick={(e) => {
          const ann = (e.target as HTMLElement).closest<HTMLElement>('[data-ann]')?.dataset.ann
          if (ann) {
            e.stopPropagation()
            onOpenAnnotation(ann)
          }
        }}
        dangerouslySetInnerHTML={{ __html: current.html }}
      />
      <nav className="mt-10 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
        <button type="button" className="dr-btn -ml-2" disabled={chapter === 0} onClick={(e) => { e.stopPropagation(); goChapter(chapter - 1) }}>
          <ChevronLeft size={18} strokeWidth={1.5} />
          上一节
        </button>
        <span className="num text-[12px] text-[var(--color-muted)]">
          {chapter + 1} / {chapters.length}
        </span>
        <button type="button" className="dr-btn -mr-2" disabled={chapter >= chapters.length - 1} onClick={(e) => { e.stopPropagation(); goChapter(chapter + 1) }}>
          下一节
          <ChevronRight size={18} strokeWidth={1.5} />
        </button>
      </nav>
    </div>
  )
})

export type { Annotation }
export default TextView
