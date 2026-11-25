import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { pageText, textInRect } from '../lib/pdf'
import { logError } from '../lib/errors'
import type { Annotation, AnnotationLoc } from '../lib/types'
import type { Box } from './useBoxSelect'
import type { Draft, ViewHandle, ViewProps } from './types'

interface Props extends ViewProps {
  pdf: PDFDocumentProxy
  initialPage: number
  zoom: number
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const GAP = 10
const MAX_CANVAS_PIXELS = 4_200_000

const PdfPage = memo(function PdfPage({
  pdf,
  pageNo,
  width,
  ratio,
  visible,
  marks,
  flashId,
  onRatio,
  onOpenAnnotation,
  canvasRefs,
}: {
  pdf: PDFDocumentProxy
  pageNo: number
  width: number
  ratio: number
  visible: boolean
  marks: Annotation[]
  flashId: string | null
  onRatio: (page: number, ratio: number) => void
  onOpenAnnotation: (id: string) => void
  canvasRefs: Map<number, HTMLCanvasElement>
}) {
  const holder = useRef<HTMLDivElement>(null)
  const height = Math.round(width * ratio)

  useEffect(() => {
    if (!visible || width <= 0) return
    let task: RenderTask | null = null
    let cancelled = false
    const canvas = document.createElement('canvas')
    void (async () => {
      try {
        const page = await pdf.getPage(pageNo)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const realRatio = base.height / base.width
        if (Math.abs(realRatio - ratio) > 0.005) onRatio(pageNo, realRatio)
        let dpr = Math.min(window.devicePixelRatio || 1, 2.5)
        const cssW = width
        const cssH = cssW * realRatio
        if (cssW * cssH * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH))
        const viewport = page.getViewport({ scale: (cssW / base.width) * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        task = page.render({ canvasContext: ctx, viewport })
        await task.promise
        if (cancelled) return
        holder.current?.querySelector('canvas')?.remove()
        holder.current?.prepend(canvas)
        canvasRefs.set(pageNo, canvas)
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== 'RenderingCancelledException') logError('pdf.render', err)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      canvas.remove()
      canvas.width = 0
      canvas.height = 0
      if (canvasRefs.get(pageNo) === canvas) canvasRefs.delete(pageNo)
    }
    // ratio 变化只影响占位高度，不重画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNo, width, visible])

  return (
    <div ref={holder} className="dr-pdf-page" data-page={pageNo} style={{ width, height }}>
      {!visible && (
        <span className="num absolute inset-0 flex items-center justify-center text-[12px] text-[var(--color-muted)]">
          {pageNo}
        </span>
      )}
      {marks.map((a) =>
        a.loc.kind === 'pdf' ? (
          <button
            key={a.id}
            type="button"
            aria-label="打开这条批注"
            className={`dr-mark${flashId === a.id ? ' is-flash' : ''}`}
            style={{
              left: `${a.loc.rect.x * 100}%`,
              top: `${a.loc.rect.y * 100}%`,
              width: `${a.loc.rect.w * 100}%`,
              height: `${a.loc.rect.h * 100}%`,
            }}
            onClick={(e) => {
              e.stopPropagation()
              onOpenAnnotation(a.id)
            }}
          />
        ) : null,
      )}
    </div>
  )
})

const PdfView = forwardRef<ViewHandle, Props>(function PdfView(
  { pdf, initialPage, zoom, scrollRef, annotations, onOpenAnnotation, onProgress, onLabel },
  ref,
) {
  const n = pdf.numPages
  const [baseRatio, setBaseRatio] = useState(1.414)
  const [ratios, setRatios] = useState<Record<number, number>>({})
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState<Set<number>>(() => new Set([initialPage]))
  const [flashId, setFlashId] = useState<string | null>(null)
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>()).current
  const restored = useRef(false)

  const ratioOf = useCallback((p: number) => ratios[p] ?? baseRatio, [ratios, baseRatio])

  // 第一页的比例作为默认占位
  useEffect(() => {
    void pdf.getPage(1).then((page) => {
      const v = page.getViewport({ scale: 1 })
      setBaseRatio(v.height / v.width)
    })
  }, [pdf])

  // 适应宽度
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const fit = () => setWidth(Math.max(200, Math.round((el.clientWidth - 16) * zoom)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef, zoom])

  const topOf = useCallback(
    (page: number) => {
      let y = 8
      for (let p = 1; p < page; p += 1) y += Math.round(width * ratioOf(p)) + GAP
      return y
    },
    [width, ratioOf],
  )

  const scrollToPage = useCallback(
    (page: number, within = 0, smooth = false) => {
      const el = scrollRef.current
      if (!el || width <= 0) return
      const top = topOf(page) + Math.round(width * ratioOf(page)) * within - el.clientHeight * 0.25 * (within > 0 ? 1 : 0)
      el.scrollTo({ top: Math.max(0, top - 4), behavior: smooth ? 'smooth' : 'auto' })
    },
    [scrollRef, width, topOf, ratioOf],
  )

  // 恢复上次位置
  useEffect(() => {
    if (restored.current || width <= 0) return
    restored.current = true
    requestAnimationFrame(() => scrollToPage(initialPage))
  }, [width, initialPage, scrollToPage])

  // 根据滚动位置决定要画哪些页、当前是第几页
  useEffect(() => {
    const el = scrollRef.current
    if (!el || width <= 0) return
    let raf = 0
    const update = () => {
      raf = 0
      const top = el.scrollTop
      const bottom = top + el.clientHeight
      const margin = el.clientHeight
      const next = new Set<number>()
      let current = 1
      let y = 8
      for (let p = 1; p <= n; p += 1) {
        const h = Math.round(width * ratioOf(p))
        if (y + h >= top - margin && y <= bottom + margin) next.add(p)
        if (y <= top + el.clientHeight * 0.4) current = p
        y += h + GAP
        if (y > bottom + margin * 2) break
      }
      setVisible((prev) => (prev.size === next.size && [...next].every((p) => prev.has(p)) ? prev : next))
      onLabel(`${current} / ${n}`)
      onProgress(current, 0, n > 1 ? (current - 1) / (n - 1) : 1)
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
  }, [scrollRef, width, n, ratioOf, onLabel, onProgress])

  const onRatio = useCallback((p: number, r: number) => setRatios((prev) => ({ ...prev, [p]: r })), [])

  useImperativeHandle(
    ref,
    () => ({
      async resolveBox(box: Box): Promise<Draft | null> {
        const cx = box.left + box.width / 2
        const cy = box.top + box.height / 2
        const pages = Array.from(document.querySelectorAll<HTMLElement>('.dr-pdf-page'))
        const pageEl =
          pages.find((el) => {
            const r = el.getBoundingClientRect()
            return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
          }) ??
          pages.find((el) => {
            const r = el.getBoundingClientRect()
            return box.top < r.bottom && box.top + box.height > r.top
          })
        if (!pageEl) return null
        const page = Number(pageEl.dataset.page)
        const r = pageEl.getBoundingClientRect()
        const x = Math.max(0, (box.left - r.left) / r.width)
        const y = Math.max(0, (box.top - r.top) / r.height)
        const rect = {
          x,
          y,
          w: Math.min(1 - x, box.width / r.width),
          h: Math.min(1 - y, box.height / r.height),
        }
        if (rect.w <= 0.005 || rect.h <= 0.005) return null
        const quote = await textInRect(pdf, page, rect)
        let image: string | undefined
        const canvas = canvasRefs.get(page)
        if (canvas) {
          const sx = rect.x * canvas.width
          const sy = rect.y * canvas.height
          const sw = rect.w * canvas.width
          const sh = rect.h * canvas.height
          const scale = Math.min(1, 1024 / Math.max(sw, sh))
          const out = document.createElement('canvas')
          out.width = Math.max(1, Math.round(sw * scale))
          out.height = Math.max(1, Math.round(sh * scale))
          const ctx = out.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#fff'
            ctx.fillRect(0, 0, out.width, out.height)
            ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height)
            image = out.toDataURL('image/jpeg', 0.85)
          }
        }
        const parts: string[] = []
        for (const p of [page - 1, page, page + 1]) {
          if (p < 1 || p > n) continue
          const t = await pageText(pdf, p)
          if (t) parts.push(`— 第 ${p} 页 —\n${t}`)
        }
        return {
          loc: { kind: 'pdf', page, rect },
          quote,
          image,
          context: parts.join('\n\n'),
          location: `第 ${page} 页`,
        }
      },
      jumpTo(loc: AnnotationLoc, flash = true) {
        if (loc.kind !== 'pdf') return
        scrollToPage(loc.page, loc.rect.y, true)
        if (flash) {
          const hit = annotations.find(
            (a) => a.loc.kind === 'pdf' && a.loc.page === loc.page && a.loc.rect.y === loc.rect.y,
          )
          setFlashId(hit?.id ?? null)
          window.setTimeout(() => setFlashId(null), 2600)
        }
      },
    }),
    [pdf, n, canvasRefs, scrollToPage, annotations],
  )

  const byPage = new Map<number, Annotation[]>()
  for (const a of annotations) {
    if (a.loc.kind !== 'pdf') continue
    const list = byPage.get(a.loc.page) ?? []
    list.push(a)
    byPage.set(a.loc.page, list)
  }

  return (
    <div className="px-2 pt-2" style={{ width: zoom > 1 ? width + 16 : undefined }}>
      {width > 0 &&
        Array.from({ length: n }, (_, i) => i + 1).map((p) => (
          <PdfPage
            key={p}
            pdf={pdf}
            pageNo={p}
            width={width}
            ratio={ratioOf(p)}
            visible={visible.has(p)}
            marks={byPage.get(p) ?? EMPTY}
            flashId={flashId}
            onRatio={onRatio}
            onOpenAnnotation={onOpenAnnotation}
            canvasRefs={canvasRefs}
          />
        ))}
    </div>
  )
})

const EMPTY: Annotation[] = []

export default PdfView
