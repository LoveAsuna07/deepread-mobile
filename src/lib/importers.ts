import DOMPurify from 'dompurify'
import ePub from 'epubjs'
import { db, uid } from './db'
import { openPdf, renderThumb } from './pdf'
import type { Chapter, CoverColorId, Doc, DocType } from './types'

export const COVER_COLORS: CoverColorId[] = ['cinnabar', 'pine', 'indigo', 'ochre', 'moss', 'ink']

export function pickColor(seed: string): CoverColorId {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 9973
  return COVER_COLORS[h % COVER_COLORS.length]
}

export function typeOf(file: File): DocType | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') return 'epub'
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt'
  return null
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '').trim() || '未命名'

export async function importFile(file: File, onStage?: (s: string) => void): Promise<Doc> {
  const type = typeOf(file)
  if (!type) throw new Error('只支持 PDF、EPUB、TXT 文件')
  if (type === 'pdf') return importPdf(file, onStage)
  if (type === 'epub') return importEpub(file, onStage)
  return importTxt(file, onStage)
}

function baseDoc(type: DocType, title: string): Doc {
  const id = uid()
  const now = Date.now()
  return {
    id,
    type,
    title,
    pageCount: 0,
    coverColor: pickColor(id),
    createdAt: now,
    lastOpenedAt: now,
  }
}

async function importPdf(file: File, onStage?: (s: string) => void): Promise<Doc> {
  onStage?.('正在读取 PDF…')
  const buffer = await file.arrayBuffer()
  const pdf = await openPdf(buffer.slice(0))
  let title = stripExt(file.name)
  try {
    const meta = await pdf.getMetadata()
    const t = (meta.info as { Title?: string } | undefined)?.Title?.trim()
    if (t && t.length > 1 && !/^untitled|microsoft word/i.test(t)) title = t
  } catch {
    // 元数据读不到就用文件名
  }
  const doc = baseDoc('pdf', title)
  doc.pageCount = pdf.numPages
  onStage?.('正在生成封面…')
  const thumb = await renderThumb(pdf)
  if (thumb) {
    doc.coverBlobId = uid()
    await db.putBlob(doc.coverBlobId, thumb)
  }
  const blobId = uid()
  await db.putBlob(blobId, new Blob([buffer], { type: 'application/pdf' }))
  await db.putContent({ id: doc.id, blobId })
  await db.putDoc(doc)
  void pdf.destroy()
  return doc
}

// ---------- TXT ----------

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // 带 BOM 的 UTF-16
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 国内常见的 GBK/GB2312 文本
    return new TextDecoder('gb18030').decode(bytes)
  }
}

const CHAPTER_RE =
  /^\s*(第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章节回卷集部篇](?:[\s:：·、.\-—]+.{0,40})?|序章.{0,30}|序言|楔子.{0,30}|引子|前言|后记|尾声.{0,30}|番外.{0,30}|Chapter\s+\d+.{0,40})\s*$/i

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function paragraphsHtml(lines: string[]): string {
  return lines
    .map((l) => l.replace(/^[\s　]+|\s+$/g, ''))
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('')
}

export function splitTxt(text: string, fallbackTitle: string): Chapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const heads: number[] = []
  lines.forEach((line, i) => {
    if (line.length <= 50 && CHAPTER_RE.test(line)) heads.push(i)
  })
  const chapters: Chapter[] = []
  if (heads.length >= 2 && heads.length < 5000) {
    if (heads[0] > 0) {
      const pre = paragraphsHtml(lines.slice(0, heads[0]))
      if (pre) chapters.push({ title: '开篇', html: pre })
    }
    heads.forEach((start, k) => {
      const end = heads[k + 1] ?? lines.length
      const title = lines[start].trim()
      chapters.push({ title, html: `<h2>${escapeHtml(title)}</h2>${paragraphsHtml(lines.slice(start + 1, end))}` })
    })
    return chapters
  }
  // 没有章节标记：按约 6000 字切段
  let buf: string[] = []
  let size = 0
  const flush = () => {
    if (!buf.length) return
    chapters.push({ title: `第 ${chapters.length + 1} 部分`, html: paragraphsHtml(buf) })
    buf = []
    size = 0
  }
  for (const line of lines) {
    buf.push(line)
    size += line.length
    if (size > 6000 && !line.trim()) flush()
  }
  flush()
  if (chapters.length === 0) chapters.push({ title: fallbackTitle, html: '<p>（空文件）</p>' })
  return chapters
}

async function importTxt(file: File, onStage?: (s: string) => void): Promise<Doc> {
  onStage?.('正在识别章节…')
  const text = decodeText(await file.arrayBuffer())
  const title = stripExt(file.name)
  const chapters = splitTxt(text, title)
  const doc = baseDoc('txt', title)
  doc.pageCount = chapters.length
  await db.putContent({ id: doc.id, chapters })
  await db.putDoc(doc)
  return doc
}

// ---------- EPUB ----------

const ALLOWED_TAGS = [
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'i', 'strong', 'b', 'u', 's',
  'sup', 'sub', 'small', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code', 'table', 'thead',
  'tbody', 'tr', 'td', 'th', 'img', 'figure', 'figcaption', 'ruby', 'rt', 'rp', 'a', 'section', 'article',
]

function resolvePath(src: string, base: string): string {
  try {
    const u = new URL(src, `https://epub.local/${base.replace(/^\/+/, '')}`)
    return decodeURIComponent(u.pathname)
  } catch {
    return src
  }
}

async function importEpub(file: File, onStage?: (s: string) => void): Promise<Doc> {
  onStage?.('正在解析 EPUB…')
  const buffer = await file.arrayBuffer()
  // epubjs 的类型声明不完整，这里按运行时结构使用
  const book: any = ePub(buffer as any)
  await book.ready
  const meta = book.packaging?.metadata ?? {}
  const title = (meta.title as string)?.trim() || stripExt(file.name)
  const doc = baseDoc('epub', title)
  if (meta.creator) doc.author = String(meta.creator).trim()

  // 目录标题：href（去掉锚点）→ 标题
  const tocTitles = new Map<string, string>()
  const walk = (items: any[]) => {
    for (const it of items ?? []) {
      const href = String(it.href ?? '').split('#')[0]
      if (href && !tocTitles.has(href)) tocTitles.set(href, String(it.label ?? '').trim())
      if (it.subitems?.length) walk(it.subitems)
    }
  }
  walk(book.navigation?.toc ?? [])
  const tocTitleOf = (href: string) => {
    const clean = href.split('#')[0]
    for (const [k, v] of tocTitles) {
      if (clean.endsWith(k) || k.endsWith(clean)) return v
    }
    return ''
  }

  const imageCache = new Map<string, string>()
  const storeImage = async (path: string): Promise<string | null> => {
    const hit = imageCache.get(path)
    if (hit) return hit
    try {
      const blob: Blob | undefined = await book.archive.getBlob(path)
      if (!blob || blob.size === 0) return null
      const id = uid()
      await db.putBlob(id, blob)
      imageCache.set(path, id)
      return id
    } catch {
      return null
    }
  }

  const sections: any[] = book.spine?.spineItems ?? []
  const chapters: Chapter[] = []
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]
    if (section.linear === false || section.linear === 'no') continue
    onStage?.(`正在解析 EPUB · ${i + 1}/${sections.length}`)
    let body: Element | null = null
    try {
      const loaded = await section.load(book.load.bind(book))
      body = (loaded?.ownerDocument ?? loaded)?.querySelector?.('body') ?? loaded
    } catch {
      continue
    }
    if (!body) continue
    const clone = body.cloneNode(true) as Element
    // 图片换成 blob 占位
    const imgs = Array.from(clone.querySelectorAll('img, image'))
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.getAttribute('href') || img.getAttribute('xlink:href') || ''
      const path = resolvePath(src, section.url || section.href || '')
      const id = await storeImage(path)
      if (id) {
        const el = img.ownerDocument.createElement('img')
        el.setAttribute('src', `dr-blob:${id}`)
        el.setAttribute('alt', img.getAttribute('alt') || '')
        img.replaceWith(el)
      } else img.remove()
    }
    const html = DOMPurify.sanitize(clone.innerHTML, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ['src', 'alt', 'colspan', 'rowspan'],
      ALLOWED_URI_REGEXP: /^dr-blob:/,
    })
    const text = clone.textContent?.replace(/\s+/g, '') ?? ''
    if (text.length < 2 && !html.includes('<img')) continue
    const heading = clone.querySelector('h1, h2, h3')?.textContent?.trim()
    const chapterTitle = tocTitleOf(section.href || '') || heading || `第 ${chapters.length + 1} 节`
    chapters.push({ title: chapterTitle.slice(0, 60), html })
  }
  if (chapters.length === 0) throw new Error('这本 EPUB 里没有读到正文')

  try {
    const coverUrl: string | null = await book.coverUrl()
    if (coverUrl) {
      const blob = await (await fetch(coverUrl)).blob()
      if (blob.size > 0) {
        doc.coverBlobId = uid()
        await db.putBlob(doc.coverBlobId, blob)
      }
    }
  } catch {
    // 没有封面就用纯色
  }
  book.destroy?.()

  doc.pageCount = chapters.length
  await db.putContent({ id: doc.id, chapters })
  await db.putDoc(doc)
  return doc
}
