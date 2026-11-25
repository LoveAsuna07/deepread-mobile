import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, FilePlus2, MoreHorizontal, NotebookPen, Settings, Upload } from 'lucide-react'
import Shelf3D, { type ShelfItem } from '../components/Shelf3D'
import { ConfirmButton, Cover, Sheet, useToast } from '../components/ui'
import NotebookDialog from '../components/NotebookDialog'
import { db } from '../lib/db'
import { logError } from '../lib/errors'
import { importFile } from '../lib/importers'
import { createNotebook } from '../lib/notes'
import { go } from '../lib/router'
import { timeAgo, TYPE_LABEL, wordCount } from '../lib/format'
import type { Doc, Notebook } from '../lib/types'

type Tab = 'all' | 'doc' | 'notebook'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function docMeta(d: Doc) {
  const pct = Math.round((d.progress ?? 0) * 100)
  if (d.type === 'pdf') return d.lastPos ? `第 ${d.lastPos} / ${d.pageCount} 页` : `${d.pageCount} 页`
  return pct > 0 ? `读到 ${pct}%` : `${d.pageCount} 节`
}

export default function ShelfPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [peekId, setPeekId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newNoteOpen, setNewNoteOpen] = useState(false)
  const [menuItem, setMenuItem] = useState<ShelfItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  async function refresh() {
    const [d, n] = await Promise.all([db.allDocs(), db.allNotebooks()])
    setDocs(d)
    setNotebooks(n)
    setReady(true)
  }

  useEffect(() => {
    void refresh().catch((e) => {
      logError('shelf.load', e)
      setReady(true)
    })
  }, [])

  const items = useMemo(() => {
    const list: (ShelfItem & { at: number })[] = []
    if (tab !== 'notebook')
      for (const d of docs)
        list.push({
          id: d.id,
          kind: 'doc',
          title: d.title,
          sub: d.author ?? TYPE_LABEL[d.type],
          tag: TYPE_LABEL[d.type],
          color: d.coverColor,
          coverBlobId: d.coverBlobId,
          meta: docMeta(d),
          at: d.lastOpenedAt,
        })
    if (tab !== 'doc')
      for (const n of notebooks)
        list.push({
          id: n.id,
          kind: 'notebook',
          title: n.title,
          sub: '笔记本',
          tag: 'NOTE',
          color: n.coverColor,
          meta: `${wordCount(n.content)} 字`,
          at: n.lastOpenedAt,
        })
    return list.sort((a, b) => b.at - a.at)
  }, [docs, notebooks, tab])

  const shelfItems = items.slice(0, 12)
  const featured = items.find((it) => it.id === peekId) ?? items[0]

  function open(item: ShelfItem) {
    go(item.kind === 'doc' ? `/read/${item.id}` : `/note/${item.id}`)
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setAddOpen(false)
    let last: Doc | null = null
    for (const file of Array.from(files)) {
      try {
        setBusy(`正在导入《${file.name}》…`)
        last = await importFile(file, (s) => setBusy(s))
      } catch (e) {
        logError('import', e)
        toast(`《${file.name}》导入失败：${(e as Error).message || '文件可能损坏'}`)
      }
    }
    setBusy('')
    await refresh()
    if (last) {
      setPeekId(last.id)
      toast(`已导入《${last.title}》`)
    }
  }

  async function removeItem(item: ShelfItem) {
    if (item.kind === 'doc') await db.deleteDoc(item.id)
    else await db.deleteNotebook(item.id)
    setMenuItem(null)
    if (peekId === item.id) setPeekId(null)
    await refresh()
    toast(`已删除《${item.title}》`)
  }

  return (
    <div className="dr-paper-grid min-h-full pb-[calc(32px+var(--safe-bottom))]">
      <header className="flex items-center justify-between px-4 pt-[calc(14px+var(--safe-top))]">
        <h1 className="font-[var(--font-reading)] text-[28px] font-medium leading-tight">{greeting()}</h1>
        <div className="flex items-center">
          <button type="button" className="dr-btn" aria-label="添加" onClick={() => setAddOpen(true)}>
            <FilePlus2 size={20} strokeWidth={1.5} />
          </button>
          <button type="button" className="dr-btn" aria-label="设置" onClick={() => go('/settings')}>
            <Settings size={20} strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <p className="px-4 pt-1 text-[14px] leading-6 text-[var(--color-ink-soft)]">
        框住看不懂的地方直接问，问过的地方变成笔记。
      </p>

      <nav className="dr-tabs mt-5 px-4" aria-label="分类">
        {(
          [
            ['all', '全部'],
            ['doc', '书'],
            ['notebook', '笔记本'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={`dr-tab${tab === key ? ' is-on' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {busy && <p className="px-4 pt-3 text-[14px] text-[var(--color-ink-soft)]">{busy}</p>}

      {ready && items.length === 0 && !busy && (
        <div className="dr-view-enter mx-4 mt-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <BookOpen size={28} strokeWidth={1.5} className="mx-auto text-[var(--color-ink-soft)]" />
          <p className="mt-3 font-[var(--font-reading)] text-[17px] font-medium">
            {tab === 'notebook' ? '还没有笔记本' : '书架还是空的'}
          </p>
          <p className="mt-1 text-[14px] leading-6 text-[var(--color-ink-soft)]">
            {tab === 'notebook' ? '读书时问过的内容可以存进笔记本。' : '导入一本 PDF、EPUB 或 TXT 开始读。'}
          </p>
          <button
            type="button"
            className="dr-btn-solid mt-5"
            onClick={() => (tab === 'notebook' ? setNewNoteOpen(true) : fileRef.current?.click())}
          >
            {tab === 'notebook' ? <NotebookPen size={18} strokeWidth={1.5} /> : <Upload size={18} strokeWidth={1.5} />}
            {tab === 'notebook' ? '新建笔记本' : '导入文件'}
          </button>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="mt-2">
            <Shelf3D items={shelfItems} peekId={peekId} onPeek={setPeekId} onOpen={open} />
          </div>
          {featured && (
            <section className="mx-4 flex items-end gap-4 border-t border-[var(--color-line)] pt-4">
              <div className="min-w-0 flex-1">
                <div className="num text-[12px] text-[var(--color-muted)]">
                  {featured.tag} · {featured.meta}
                </div>
                <h2 className="mt-1 line-clamp-2 font-[var(--font-reading)] text-[22px] font-medium leading-snug">
                  {featured.title}
                </h2>
                <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
                  {peekId ? '再点一次书，或点右边打开' : '点书脊把它抽出来看看'}
                </p>
              </div>
              <button type="button" className="dr-btn-solid flex-none" onClick={() => open(featured)}>
                {featured.kind === 'doc' ? '继续读' : '打开'}
              </button>
            </section>
          )}

          <section className="mt-8 px-4">
            <h3 className="font-[var(--font-reading)] text-[17px] font-medium">
              {tab === 'notebook' ? '全部笔记本' : tab === 'doc' ? '全部书' : '全部'}
              <span className="num ml-2 text-[12px] font-normal text-[var(--color-muted)]">{items.length}</span>
            </h3>
            <ul className="mt-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 border-b border-[var(--color-line)] py-3">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open(it)}>
                    <Cover
                      title={it.title}
                      color={it.color}
                      blobId={it.coverBlobId}
                      className="h-[60px] w-[42px] flex-none"
                      titleSize={8}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{it.title}</span>
                      <span className="mt-0.5 block text-[13px] text-[var(--color-ink-soft)]">
                        {it.kind === 'doc' ? it.tag : '笔记本'} · {it.meta} · {timeAgo(it.at)}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="dr-btn flex-none" aria-label="更多" onClick={() => setMenuItem(it)}>
                    <MoreHorizontal size={18} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain"
        className="hidden"
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="添加">
        <div className="px-2 pb-4">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[var(--color-hover)]" onClick={() => fileRef.current?.click()}>
            <Upload size={20} strokeWidth={1.5} className="text-[var(--color-ink-soft)]" />
            <span>
              <span className="block">导入书</span>
              <span className="block text-[13px] text-[var(--color-ink-soft)]">PDF、EPUB、TXT，可以一次选多本</span>
            </span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[var(--color-hover)]"
            onClick={() => {
              setAddOpen(false)
              setNewNoteOpen(true)
            }}
          >
            <NotebookPen size={20} strokeWidth={1.5} className="text-[var(--color-ink-soft)]" />
            <span>
              <span className="block">新建笔记本</span>
              <span className="block text-[13px] text-[var(--color-ink-soft)]">Markdown 笔记，读书时可以直接往里存</span>
            </span>
          </button>
        </div>
      </Sheet>

      <NotebookDialog
        open={newNoteOpen}
        onClose={() => setNewNoteOpen(false)}
        onSubmit={async (title, color) => {
          const nb = await createNotebook(title, color)
          setNewNoteOpen(false)
          go(`/note/${nb.id}`)
        }}
      />

      <Sheet open={!!menuItem} onClose={() => setMenuItem(null)} title={menuItem?.title}>
        {menuItem && (
          <div className="flex items-center justify-between px-4 pb-5 pt-1">
            <button type="button" className="dr-btn -ml-2" onClick={() => open(menuItem)}>
              打开
            </button>
            <ConfirmButton label="删除" onConfirm={() => void removeItem(menuItem)} />
          </div>
        )}
      </Sheet>
    </div>
  )
}
