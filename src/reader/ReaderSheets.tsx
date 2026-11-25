import { useEffect, useState } from 'react'
import { BookmarkPlus, Check, CornerDownRight, NotebookPen, Plus } from 'lucide-react'
import NotebookDialog from '../components/NotebookDialog'
import { ConfirmButton, COLOR_VAR, Sheet, useBlobUrl } from '../components/ui'
import { MODE_LABEL } from '../lib/ai'
import { db } from '../lib/db'
import { mdToHtml, timeAgo, wordCount } from '../lib/format'
import { createNotebook, lastNotebookId } from '../lib/notes'
import type { Annotation, Notebook } from '../lib/types'

// ---------- 批注列表 ----------

function AnnotationCard({
  a,
  index,
  where,
  expanded,
  onToggle,
  onJump,
  onSaveToNote,
  onDelete,
}: {
  a: Annotation
  index: number
  where: string
  expanded: boolean
  onToggle: () => void
  onJump: () => void
  onSaveToNote: () => void
  onDelete: () => void
}) {
  const img = useBlobUrl(a.imageBlobId)
  return (
    <li className="border-b border-[var(--color-line)] px-4 py-4" data-ann-card={a.id}>
      <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)]">
        <span className="num">
          #{String(index + 1).padStart(2, '0')} · {where}
        </span>
        <span>{timeAgo(a.createdAt)}</span>
      </div>
      {img && <img src={img} alt="" className="mt-2 max-h-28 rounded border border-[var(--color-line)]" />}
      {a.quote && <p className="dr-quote mt-2 line-clamp-3 whitespace-pre-line">{a.quote}</p>}
      <p className="mt-3 text-[15px] font-medium">{a.question || MODE_LABEL[a.mode]}</p>
      <button type="button" className="mt-1 block w-full text-left" onClick={onToggle}>
        <div
          className={`dr-answer text-[15px] ${expanded ? '' : 'line-clamp-3'}`}
          dangerouslySetInnerHTML={{ __html: mdToHtml(a.answer) }}
        />
        {!expanded && <span className="text-[13px] text-[var(--color-ink-soft)]">展开</span>}
      </button>
      <div className="-ml-2 mt-2 flex flex-wrap items-center">
        <button type="button" className="dr-btn" onClick={onJump}>
          <CornerDownRight size={16} strokeWidth={1.5} />
          回到原文
        </button>
        <button type="button" className="dr-btn" onClick={onSaveToNote}>
          <BookmarkPlus size={16} strokeWidth={1.5} />
          存到笔记
        </button>
        <ConfirmButton label="删除" onConfirm={onDelete} />
      </div>
    </li>
  )
}

export function AnnotationsSheet({
  open,
  onClose,
  annotations,
  focusId,
  whereOf,
  onJump,
  onSaveToNote,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  annotations: Annotation[]
  focusId: string | null
  whereOf: (a: Annotation) => string
  onJump: (a: Annotation) => void
  onSaveToNote: (a: Annotation) => void
  onDelete: (a: Annotation) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setExpanded(focusId)
    if (focusId)
      requestAnimationFrame(() =>
        document.querySelector(`[data-ann-card="${focusId}"]`)?.scrollIntoView({ block: 'start' }),
      )
  }, [open, focusId])

  return (
    <Sheet open={open} onClose={onClose} title={`批注 ${annotations.length}`} tall>
      {annotations.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] leading-6 text-[var(--color-ink-soft)]">
          还没有批注。
          <br />
          长按正文再拖动框住一段，或者点上方的“框选”。
        </p>
      ) : (
        <ul>
          {annotations.map((a, i) => (
            <AnnotationCard
              key={a.id}
              a={a}
              index={i}
              where={whereOf(a)}
              expanded={expanded === a.id}
              onToggle={() => setExpanded(expanded === a.id ? null : a.id)}
              onJump={() => onJump(a)}
              onSaveToNote={() => onSaveToNote(a)}
              onDelete={() => onDelete(a)}
            />
          ))}
        </ul>
      )}
    </Sheet>
  )
}

// ---------- 选笔记本 ----------

export function SaveToNoteSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (nb: Notebook) => void
}) {
  const [list, setList] = useState<Notebook[]>([])
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (!open) return
    void db.allNotebooks().then((all) => {
      const last = lastNotebookId()
      setList(all.sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : b.updatedAt - a.updatedAt)))
    })
  }, [open])
  const last = lastNotebookId()

  return (
    <>
      <Sheet open={open && !creating} onClose={onClose} title="存到哪本笔记">
        <ul className="px-2 pb-3">
          {list.map((nb) => (
            <li key={nb.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[var(--color-hover)]"
                onClick={() => onPick(nb)}
              >
                <span className="h-9 w-1.5 flex-none rounded-sm" style={{ background: COLOR_VAR[nb.coverColor] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{nb.title}</span>
                  <span className="block text-[12px] text-[var(--color-muted)]">
                    {wordCount(nb.content)} 字 · {timeAgo(nb.updatedAt)}
                  </span>
                </span>
                {nb.id === last && <Check size={16} strokeWidth={1.5} className="text-[var(--color-ink-soft)]" />}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[var(--color-ink-soft)] active:bg-[var(--color-hover)]"
              onClick={() => setCreating(true)}
            >
              {list.length ? <Plus size={18} strokeWidth={1.5} /> : <NotebookPen size={18} strokeWidth={1.5} />}
              新建笔记本
            </button>
          </li>
        </ul>
      </Sheet>
      <NotebookDialog
        open={open && creating}
        onClose={() => setCreating(false)}
        onSubmit={async (title, color) => {
          const nb = await createNotebook(title, color)
          setCreating(false)
          onPick(nb)
        }}
      />
    </>
  )
}

// ---------- 目录 ----------

export interface TocItem {
  title: string
  level: number
  target: number
}

export function TocSheet({
  open,
  onClose,
  items,
  current,
  onPick,
}: {
  open: boolean
  onClose: () => void
  items: TocItem[]
  current: number
  onPick: (target: number) => void
}) {
  useEffect(() => {
    if (open) requestAnimationFrame(() => document.querySelector('[data-toc-current]')?.scrollIntoView({ block: 'center' }))
  }, [open])
  const currentIndex = items.reduce((best, it, i) => (it.target <= current ? i : best), -1)
  return (
    <Sheet open={open} onClose={onClose} title="目录" tall>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-[var(--color-ink-soft)]">这份文档没有目录</p>
      ) : (
        <ul className="pb-4">
          {items.map((it, i) => (
            <li key={i}>
              <button
                type="button"
                data-toc-current={i === currentIndex ? '' : undefined}
                className={`flex w-full items-baseline gap-3 py-3 pr-4 text-left text-[15px] active:bg-[var(--color-hover)] ${
                  i === currentIndex ? 'text-[var(--color-accent)]' : ''
                }`}
                style={{ paddingLeft: 16 + Math.min(3, it.level) * 14 }}
                onClick={() => onPick(it.target)}
              >
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
