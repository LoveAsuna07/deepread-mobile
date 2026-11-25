import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Download, ListTree, MoreHorizontal, Palette, Pencil } from 'lucide-react'
import MarkdownEditor, { type MarkdownGetter } from '../components/MarkdownEditor'
import NotebookDialog from '../components/NotebookDialog'
import { ConfirmButton, COLOR_VAR, Sheet, useToast } from '../components/ui'
import { db } from '../lib/db'
import { logError } from '../lib/errors'
import { wordCount } from '../lib/format'
import { rememberNotebook } from '../lib/notes'
import { back, go } from '../lib/router'
import type { Notebook } from '../lib/types'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function headingsOf(md: string) {
  const out: { level: number; text: string; index: number }[] = []
  let inCode = false
  let n = 0
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) inCode = !inCode
    if (inCode) continue
    const m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ''), index: n++ })
  }
  return out
}

export default function NotebookPage({ notebookId }: { notebookId: string }) {
  const [nb, setNb] = useState<Notebook | null>(null)
  const [missing, setMissing] = useState(false)
  const [content, setContent] = useState('')
  const [save, setSave] = useState<SaveState>('saved')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const editorRef: MarkdownGetter = useRef(null)
  const nbRef = useRef<Notebook | null>(null)
  const dirty = useRef(false)
  const timer = useRef(0)
  const toast = useToast()
  nbRef.current = nb

  useEffect(() => {
    void db.getNotebook(notebookId).then((n) => {
      if (!n) {
        setMissing(true)
        return
      }
      const opened = { ...n, lastOpenedAt: Date.now() }
      void db.putNotebook(opened)
      rememberNotebook(n.id)
      setNb(opened)
      setContent(n.content)
    })
  }, [notebookId])

  /** 保存时直接从编辑器取最新内容，避免最后几下输入还没回调就丢 */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const base = nbRef.current
    if (!dirty.current || !base) return
    dirty.current = false
    const md = editorRef.current?.() ?? null
    if (md === null) return
    setSave('saving')
    try {
      const latest = (await db.getNotebook(base.id)) ?? base
      const next = { ...latest, content: md, updatedAt: Date.now() }
      await db.putNotebook(next)
      nbRef.current = next
      setSave('saved')
    } catch (e) {
      logError('note.save', e)
      dirty.current = true
      setSave('error')
    }
  }, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  function onChange(md: string) {
    setContent(md)
    dirty.current = true
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 800)
  }

  async function updateMeta(patch: Partial<Notebook>) {
    if (!nb) return
    const latest = (await db.getNotebook(nb.id)) ?? nb
    const next = { ...latest, ...patch, updatedAt: Date.now() }
    await db.putNotebook(next)
    setNb(next)
  }

  function exportMd() {
    if (!nb) return
    const md = editorRef.current?.() ?? content
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${nb.title}.md`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    setMenuOpen(false)
  }

  function scrollToHeading(i: number) {
    setOutlineOpen(false)
    const hs = document.querySelectorAll('.dr-note .ProseMirror h1, .dr-note .ProseMirror h2, .dr-note .ProseMirror h3, .dr-note .ProseMirror h4')
    window.setTimeout(() => hs[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }

  if (missing)
    return (
      <div className="p-6">
        <p>这本笔记不存在了。</p>
        <button type="button" className="dr-btn-solid mt-4" onClick={() => go('/', true)}>
          回书架
        </button>
      </div>
    )
  if (!nb) return <div className="p-6 text-[14px] text-[var(--color-ink-soft)]">正在打开…</div>

  const heads = headingsOf(content)

  return (
    <div className="min-h-full bg-[var(--color-paper)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-paper)] pt-[var(--safe-top)]">
        <div className="flex h-12 items-center gap-1 px-1">
          <button
            type="button"
            className="dr-btn"
            aria-label="返回"
            onClick={() => {
              void flush()
              back()
            }}
          >
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>
          <span className="h-6 w-1.5 flex-none rounded-sm" style={{ background: COLOR_VAR[nb.coverColor] }} />
          <div className="min-w-0 flex-1 pl-1">
            <div className="truncate font-[var(--font-reading)] text-[16px] font-medium">{nb.title}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
              <i
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    save === 'saved' ? 'var(--color-success)' : save === 'error' ? 'var(--color-accent)' : 'var(--color-pin)',
                }}
              />
              <span>{save === 'saved' ? '已保存' : save === 'saving' ? '保存中' : save === 'error' ? '保存失败' : '未保存'}</span>
              <span className="num">· {wordCount(content)} 字</span>
            </div>
          </div>
          <button type="button" className="dr-btn" aria-label="大纲" onClick={() => setOutlineOpen(true)}>
            <ListTree size={20} strokeWidth={1.5} />
          </button>
          <button type="button" className="dr-btn" aria-label="更多" onClick={() => setMenuOpen(true)}>
            <MoreHorizontal size={20} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] pt-2">
        <MarkdownEditor
          getter={editorRef}
          value={nb.content}
          onChange={onChange}
          onLink={(href) => {
            if (!href.startsWith('#/')) return false
            void flush()
            go(href.slice(1))
            return true
          }}
        />
      </main>

      <Sheet open={outlineOpen} onClose={() => setOutlineOpen(false)} title="大纲">
        {heads.length === 0 ? (
          <p className="px-4 py-6 text-center text-[14px] text-[var(--color-ink-soft)]">用 # 开头写标题，这里会自动生成大纲</p>
        ) : (
          <ul className="pb-4">
            {heads.map((h) => (
              <li key={h.index}>
                <button
                  type="button"
                  className="block w-full truncate py-3 pr-4 text-left text-[15px] active:bg-[var(--color-hover)]"
                  style={{ paddingLeft: 16 + (h.level - 1) * 14 }}
                  onClick={() => scrollToHeading(h.index)}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={nb.title}>
        <div className="px-2 pb-4">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[var(--color-hover)]"
            onClick={() => {
              setMenuOpen(false)
              setEditOpen(true)
            }}
          >
            <Pencil size={18} strokeWidth={1.5} className="text-[var(--color-ink-soft)]" />
            改名字
            <Palette size={18} strokeWidth={1.5} className="ml-2 text-[var(--color-ink-soft)]" />
            换颜色
          </button>
          <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[var(--color-hover)]" onClick={exportMd}>
            <Download size={18} strokeWidth={1.5} className="text-[var(--color-ink-soft)]" />
            导出 .md 文件
          </button>
          <div className="mt-1 flex items-center justify-between px-1">
            <span className="text-[13px] text-[var(--color-muted)]">删除后找不回来</span>
            <ConfirmButton
              label="删除笔记本"
              onConfirm={() => {
                void db.deleteNotebook(nb.id).then(() => {
                  toast(`已删除《${nb.title}》`)
                  go('/', true)
                })
              }}
            />
          </div>
        </div>
      </Sheet>

      <NotebookDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        heading="改名字和颜色"
        submitLabel="保存"
        initialTitle={nb.title}
        initialColor={nb.coverColor}
        onSubmit={async (title, color) => {
          await updateMeta({ title, coverColor: color })
          setEditOpen(false)
        }}
      />
    </div>
  )
}
