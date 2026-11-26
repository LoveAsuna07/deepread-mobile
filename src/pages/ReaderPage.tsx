import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, List, MessageSquareText, Minus, Plus, SquareDashed, Type, X } from 'lucide-react'
import { Sheet, useToast } from '../components/ui'
import { loadAiSettings } from '../lib/ai'
import { db } from '../lib/db'
import { logError } from '../lib/errors'
import { appendToNotebook, annotationMarkdown, locationLabel } from '../lib/notes'
import { openPdf } from '../lib/pdf'
import { MARGINS, READING_THEMES, resolveReading, themeSpec, themeVars, TYPEFACES } from '../lib/readingTheme'
import { back, go } from '../lib/router'
import type { AiSettings, Annotation, Doc, DocContent, ReadingSettings } from '../lib/types'
import AskSheet from '../reader/AskSheet'
import PdfView from '../reader/PdfView'
import { AnnotationsSheet, SaveToNoteSheet, TocSheet, type TocItem } from '../reader/ReaderSheets'
import TextView from '../reader/TextView'
import type { Draft, ViewHandle } from '../reader/types'
import { useBoxSelect, type Box } from '../reader/useBoxSelect'

const HINT_KEY = 'dr-hint-box-seen'
const READING_KEY = 'reading-settings'
const ZOOMS = [1, 1.25, 1.5, 2]

async function pdfToc(pdf: PDFDocumentProxy): Promise<TocItem[]> {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline) return []
  const out: TocItem[] = []
  const walk = async (items: typeof outline, level: number) => {
    for (const it of items) {
      if (out.length > 600) return
      let page = 0
      try {
        const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest
        if (Array.isArray(dest) && dest[0]) {
          page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1
        }
      } catch {
        // 解析不了的目录项跳过页码
      }
      if (page) out.push({ title: it.title, level, target: page })
      if (it.items?.length) await walk(it.items, level + 1)
    }
  }
  await walk(outline, 0)
  return out
}

export default function ReaderPage({ docId, query }: { docId: string; query: URLSearchParams }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [content, setContent] = useState<DocContent | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [reading, setReading] = useState(() => resolveReading())
  const readingRef = useRef(reading)
  readingRef.current = reading
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [label, setLabel] = useState('')
  const [pct, setPct] = useState(0)
  const [bars, setBars] = useState(true)
  const [force, setForce] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [typeOpen, setTypeOpen] = useState(false)
  const [noteFor, setNoteFor] = useState<Annotation | null>(null)
  const [hint, setHint] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ViewHandle>(null)
  const progressTimer = useRef(0)
  const pendingProgress = useRef<Partial<Doc> | null>(null)
  const toast = useToast()

  // ---------- 加载 ----------
  useEffect(() => {
    let alive = true
    let opened: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const [d, c, anns, settings, rs] = await Promise.all([
          db.getDoc(docId),
          db.getContent(docId),
          db.annotationsOf(docId),
          loadAiSettings(),
          db.getKv<ReadingSettings>(READING_KEY),
        ])
        if (!alive) return
        if (!d || !c) {
          setError('找不到这本书，可能已经被删除了。')
          return
        }
        setAi(settings)
        setReading(resolveReading(rs, d.reading))
        setAnnotations(anns)
        setChapter(d.type === 'pdf' ? 0 : Math.min(d.lastPos ?? 0, (c.chapters?.length ?? 1) - 1))
        if (d.type === 'pdf') {
          const blob = c.blobId ? await db.getBlob(c.blobId) : undefined
          if (!blob) throw new Error('PDF 文件丢失了')
          opened = await openPdf(await blob.arrayBuffer())
          if (!alive) return
          setPdf(opened)
          void pdfToc(opened).then((t) => alive && setToc(t))
        } else {
          setToc((c.chapters ?? []).map((ch, i) => ({ title: ch.title, level: 0, target: i })))
        }
        setContent(c)
        setDoc(d)
        void db.patchDoc(d.id, { lastOpenedAt: Date.now() })
        try {
          if (!localStorage.getItem(HINT_KEY)) setHint(true)
        } catch {
          // 忽略
        }
      } catch (err) {
        logError('reader.load', err)
        if (alive) setError(`打不开这本书：${(err as Error).message}`)
      }
    })()
    return () => {
      alive = false
      void opened?.destroy()
    }
  }, [docId])

  // 设置页回来后重新读 key
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'visible') void loadAiSettings().then(setAi)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // 从笔记回链进来：跳到那条批注
  const jumpedRef = useRef(false)
  useEffect(() => {
    const target = query.get('a')
    if (!target || jumpedRef.current || !doc || !viewRef.current) return
    const a = annotations.find((x) => x.id === target)
    if (!a) return
    jumpedRef.current = true
    window.setTimeout(() => viewRef.current?.jumpTo(a.loc), 300)
  }, [query, doc, annotations, pdf, content])

  // ---------- 进度 ----------
  const flushProgress = useCallback(() => {
    window.clearTimeout(progressTimer.current)
    const p = pendingProgress.current
    pendingProgress.current = null
    if (p) void db.patchDoc(docId, p)
  }, [docId])

  const onProgress = useCallback(
    (pos: number, offset: number, progress: number) => {
      pendingProgress.current = { lastPos: pos, lastOffset: offset, progress, lastOpenedAt: Date.now() }
      setPct(Math.floor(progress * 1000) / 10)
      window.clearTimeout(progressTimer.current)
      progressTimer.current = window.setTimeout(flushProgress, 600)
    },
    [flushProgress],
  )

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushProgress()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushProgress()
    }
  }, [flushProgress])

  // ---------- 框选 ----------
  const onBox = useCallback(
    async (box: Box) => {
      setForce(false)
      const view = viewRef.current
      if (!view) return
      try {
        const d = await view.resolveBox(box)
        if (!d) {
          toast('框里没有读到内容，换个位置再试试')
          clearBox()
          return
        }
        setDraft(d)
        setHint(false)
        try {
          localStorage.setItem(HINT_KEY, '1')
        } catch {
          // 忽略
        }
      } catch (err) {
        logError('box', err)
        toast('框选失败了')
        clearBox()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  )
  const { box, ring, clearBox, justSelected } = useBoxSelect(scrollRef, {
    force,
    ready: !!(doc && content && ai && (doc.type !== 'pdf' || pdf)),
    onBox: (b) => void onBox(b),
    onCancel: () => setForce(false),
  })

  // ---------- 批注 ----------
  const chapters = content?.chapters ?? []
  const whereOf = useCallback(
    (a: Annotation) => (doc ? locationLabel(a, doc, a.loc.kind === 'text' ? chapters[a.loc.chapter]?.title : undefined) : ''),
    [doc, chapters],
  )

  const sorted = useMemo(() => [...annotations].sort((a, b) => b.createdAt - a.createdAt), [annotations])

  async function saveToNotebook(a: Annotation, notebookId: string, title: string) {
    if (!doc) return
    const md = annotationMarkdown(a, doc, a.loc.kind === 'text' ? chapters[a.loc.chapter]?.title : undefined)
    const nb = await appendToNotebook(notebookId, md)
    setNoteFor(null)
    toast(nb ? `已存到《${title}》` : '存失败了，笔记本可能被删了')
  }

  // 夜间等主题：手机状态栏颜色跟着变，离开阅读页再还原
  useEffect(() => {
    if (!doc || doc.type === 'pdf') return
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return
    const prev = meta.getAttribute('content')
    meta.setAttribute('content', themeSpec(reading.theme).background)
    return () => {
      if (prev) meta.setAttribute('content', prev)
    }
  }, [doc, reading.theme])

  // 手指往下读时收起顶栏底栏；往回滑不弹出来，点屏幕中间才呼出
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let last = el.scrollTop
    let touched = 0
    const mark = () => (touched = Date.now())
    const onScroll = () => {
      const y = el.scrollTop
      const d = y - last
      last = y
      if (d > 4 && Date.now() - touched < 1200) setBars(false)
    }
    el.addEventListener('touchstart', mark, { passive: true })
    el.addEventListener('pointerdown', mark, { passive: true })
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('touchstart', mark)
      el.removeEventListener('pointerdown', mark)
      el.removeEventListener('wheel', mark)
      el.removeEventListener('scroll', onScroll)
    }
  }, [doc, content, pdf])

  if (error)
    return (
      <div className="p-6">
        <p className="text-[15px]">{error}</p>
        <button type="button" className="dr-btn-solid mt-4" onClick={() => go('/', true)}>
          回书架
        </button>
      </div>
    )

  if (!doc || !content || !ai || (doc.type === 'pdf' && !pdf))
    return <div className="p-6 text-[14px] text-[var(--color-ink-soft)]">正在打开…</div>

  const isPdf = doc.type === 'pdf'
  const tv = isPdf ? undefined : themeVars(reading.theme)

  return (
    <div className={`fixed inset-0 flex flex-col bg-[var(--color-paper)]${bars ? ' dr-bars-on' : ''}`} style={tv ? { background: tv.background } : undefined}>
      <header
        className={`absolute inset-x-0 top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-paper)] pt-[var(--safe-top)] transition-transform duration-300 ${
          bars ? '' : '-translate-y-full'
        }`}
        style={tv}
      >
        <div className="flex h-12 items-center gap-1 px-1">
          <button type="button" className="dr-btn" aria-label="返回" onClick={back}>
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-[var(--font-reading)] text-[15px]">{doc.title}</div>
            <div className="num text-[11px] text-[var(--color-muted)]">{label}</div>
          </div>
          <button
            type="button"
            className={`dr-btn${force ? ' is-on' : ''}`}
            aria-label="框选"
            aria-pressed={force}
            onClick={() => setForce((f) => !f)}
          >
            <SquareDashed size={20} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="dr-btn relative"
            aria-label={`批注 ${annotations.length}`}
            onClick={() => {
              setFocusId(null)
              setListOpen(true)
            }}
          >
            <MessageSquareText size={20} strokeWidth={1.5} />
            {annotations.length > 0 && (
              <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-[var(--color-pin)] px-1 text-center text-[10px] leading-4 text-[var(--color-ink)]">
                {annotations.length}
              </span>
            )}
          </button>
          <button type="button" className="dr-btn" aria-label="目录" onClick={() => setTocOpen(true)}>
            <List size={20} strokeWidth={1.5} />
          </button>
          <button type="button" className="dr-btn" aria-label="阅读设置" onClick={() => setTypeOpen(true)}>
            <Type size={20} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="dr-reader-content min-h-0 flex-1 overflow-auto overscroll-contain pt-[calc(48px+var(--safe-top))]"
        style={{ ...tv, touchAction: force ? 'none' : undefined }}
        onClick={(e) => {
          if (justSelected.current) return
          const el = scrollRef.current
          // 栏开着时点哪都先收起；文本书点上三分之一往上翻一屏、下三分之一往下翻一屏、中间呼出栏
          if (isPdf || bars || !el) {
            setBars((b) => !b)
            return
          }
          const h = window.innerHeight
          if (e.clientY < h * 0.3) el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
          else if (e.clientY > h * 0.7) el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
          else setBars(true)
        }}
      >
        {isPdf && pdf ? (
          <PdfView
            ref={viewRef}
            pdf={pdf}
            initialPage={doc.lastPos ?? 1}
            zoom={zoom}
            scrollRef={scrollRef}
            annotations={annotations}
            onOpenAnnotation={(id) => {
              setFocusId(id)
              setListOpen(true)
            }}
            onProgress={onProgress}
            onLabel={setLabel}
          />
        ) : (
          <TextView
            ref={viewRef}
            chapters={chapters}
            chapter={chapter}
            initialOffset={doc.lastOffset ?? 0}
            onChapter={setChapter}
            fontSize={reading.fontSize}
            lineHeight={reading.lineHeight}
            fontFamily={TYPEFACES.find((t) => t.id === reading.typeface)!.family}
            margin={MARGINS.find((m) => m.id === reading.margin)!.px}
            scrollRef={scrollRef}
            annotations={annotations}
            onOpenAnnotation={(id) => {
              setFocusId(id)
              setListOpen(true)
            }}
            onProgress={onProgress}
            onLabel={setLabel}
          />
        )}
        <div className="h-[calc(24px+var(--safe-bottom))]" />
      </div>

      <footer
        className={`absolute inset-x-0 bottom-0 z-20 border-t border-[var(--color-line)] bg-[var(--color-paper)] pb-[var(--safe-bottom)] transition-transform duration-300 ${
          bars ? '' : 'translate-y-full'
        }`}
        style={tv}
      >
        <div className="flex h-12 items-center gap-1 px-1">
          {!isPdf && (
            <button type="button" className="dr-btn" aria-label="上一章" disabled={chapter === 0} onClick={() => setChapter(chapter - 1)}>
              <ChevronLeft size={20} strokeWidth={1.5} />
            </button>
          )}
          <button type="button" className="min-w-0 flex-1 text-center" onClick={() => setTocOpen(true)}>
            <span className="block truncate font-[var(--font-reading)] text-[13px] text-[var(--color-ink)]">
              {isPdf ? `第 ${label} 页` : chapters[chapter]?.title || `第 ${chapter + 1} 节`}
            </span>
            <span className="num block text-[11px] text-[var(--color-muted)]">已读 {pct.toFixed(1)}%</span>
          </button>
          {!isPdf && (
            <button
              type="button"
              className="dr-btn"
              aria-label="下一章"
              disabled={chapter >= chapters.length - 1}
              onClick={() => setChapter(chapter + 1)}
            >
              <ChevronRight size={20} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </footer>

      {force && (
        <div className="dr-toast flex items-center gap-3" role="status">
          <span>直接拖动，框住想问的地方</span>
          <button type="button" aria-label="取消框选" onClick={() => setForce(false)}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {hint && !force && !draft && !typeOpen && !tocOpen && !listOpen && (
        <div className="dr-toast flex items-center gap-3" role="status">
          <span>长按正文一下再拖动，就能框住看不懂的地方提问</span>
          <button
            type="button"
            className="flex-none font-medium text-[var(--color-pin)]"
            onClick={() => {
              setHint(false)
              try {
                localStorage.setItem(HINT_KEY, '1')
              } catch {
                // 忽略
              }
            }}
          >
            知道了
          </button>
        </div>
      )}

      {box && <div className="dr-box" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
      {ring && <div className="dr-press-ring" style={{ left: ring.x, top: ring.y }} />}

      <AskSheet
        doc={doc}
        draft={draft}
        ai={ai}
        onClose={() => {
          setDraft(null)
          clearBox()
        }}
        onSaved={(a, replaces) =>
          setAnnotations((prev) => [...prev.filter((x) => x.id !== replaces), a])
        }
        onSaveToNote={(a) => setNoteFor(a)}
      />

      <AnnotationsSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        annotations={sorted}
        focusId={focusId}
        whereOf={whereOf}
        onJump={(a) => {
          setListOpen(false)
          window.setTimeout(() => viewRef.current?.jumpTo(a.loc), 120)
        }}
        onSaveToNote={(a) => setNoteFor(a)}
        onDelete={(a) => {
          void db.deleteAnnotation(a.id)
          if (a.imageBlobId) void db.deleteBlob(a.imageBlobId)
          setAnnotations((prev) => prev.filter((x) => x.id !== a.id))
        }}
      />

      <SaveToNoteSheet
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        onPick={(nb) => noteFor && void saveToNotebook(noteFor, nb.id, nb.title)}
      />

      <TocSheet
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        items={toc}
        current={isPdf ? Number(label.split('/')[0]) || 1 : chapter}
        onPick={(target) => {
          setTocOpen(false)
          if (isPdf) window.setTimeout(() => viewRef.current?.jumpTo({ kind: 'pdf', page: target, rect: { x: 0, y: 0, w: 0, h: 0 } }, false), 120)
          else setChapter(target)
        }}
      />

      <Sheet open={typeOpen} onClose={() => setTypeOpen(false)} title={isPdf ? '缩放' : '阅读设置'}>
        <div className="px-4 pb-6">
          {isPdf ? (
            <div className="flex gap-2">
              {ZOOMS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`num h-10 flex-1 rounded-lg border text-[14px] ${
                    zoom === z ? 'border-[var(--color-ink)] text-[var(--color-ink)]' : 'border-[var(--color-line-strong)] text-[var(--color-ink-soft)]'
                  }`}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[15px]">字号</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="dr-btn" aria-label="字号减小" onClick={() => updateReading({ fontSize: Math.max(14, reading.fontSize - 1) })}>
                    <Minus size={18} strokeWidth={1.5} />
                  </button>
                  <span className="num w-8 text-center text-[15px]">{reading.fontSize}</span>
                  <button type="button" className="dr-btn" aria-label="字号增大" onClick={() => updateReading({ fontSize: Math.min(26, reading.fontSize + 1) })}>
                    <Plus size={18} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[15px]">行距</span>
                <div className="flex gap-2">
                  {[1.6, 1.85, 2.1].map((lh) => (
                    <button
                      key={lh}
                      type="button"
                      onClick={() => updateReading({ lineHeight: lh })}
                      className={`h-9 rounded-lg border px-3 text-[14px] ${
                        reading.lineHeight === lh ? 'border-[var(--color-ink)]' : 'border-[var(--color-line-strong)] text-[var(--color-ink-soft)]'
                      }`}
                    >
                      {lh === 1.6 ? '紧凑' : lh === 1.85 ? '适中' : '宽松'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[15px]">背景</span>
                <div className="flex gap-3">
                  {READING_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-label={t.label}
                      aria-pressed={reading.theme === t.id}
                      onClick={() => updateReading({ theme: t.id })}
                      className="flex flex-col items-center gap-1"
                    >
                      <span
                        className="block size-9 rounded-full border"
                        style={{
                          background: t.background,
                          borderColor: 'var(--color-line-strong)',
                          boxShadow: reading.theme === t.id ? '0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink)' : undefined,
                        }}
                      />
                      <span className="text-[11px] text-[var(--color-ink-soft)]">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[15px]">字体</span>
                <div className="flex gap-2">
                  {TYPEFACES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => updateReading({ typeface: t.id })}
                      style={{ fontFamily: t.family }}
                      className={`h-9 rounded-lg border px-4 text-[14px] ${
                        reading.typeface === t.id ? 'border-[var(--color-ink)]' : 'border-[var(--color-line-strong)] text-[var(--color-ink-soft)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[15px]">边距</span>
                <div className="flex gap-2">
                  {MARGINS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => updateReading({ margin: m.id })}
                      className={`h-9 w-12 rounded-lg border text-[14px] ${
                        reading.margin === m.id ? 'border-[var(--color-ink)]' : 'border-[var(--color-line-strong)] text-[var(--color-ink-soft)]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-[12px] leading-5 text-[var(--color-muted)]">设置跟着这本书走；新打开的书沿用最近一次的设置。</p>
            </>
          )}
        </div>
      </Sheet>
    </div>
  )

  function updateReading(patch: Partial<ReadingSettings>) {
    // 连着点两个选项时，用最新的值合并，免得后一次把前一次盖掉
    const next = { ...readingRef.current, ...patch }
    readingRef.current = next
    setReading(next)
    void db.putKv(READING_KEY, next)
    if (doc) void db.patchDoc(doc.id, { reading: next })
  }
}
