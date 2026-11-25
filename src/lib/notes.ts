import { db, uid } from './db'
import { pickColor } from './importers'
import type { Annotation, CoverColorId, Doc, Notebook } from './types'
import { MODE_LABEL } from './ai'

const LAST_KEY = 'dr-last-notebook'

export function lastNotebookId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function rememberNotebook(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    // 忽略
  }
}

export async function createNotebook(title: string, coverColor?: CoverColorId): Promise<Notebook> {
  const now = Date.now()
  const id = uid()
  const nb: Notebook = {
    id,
    title: title.trim() || '未命名笔记',
    coverColor: coverColor ?? pickColor(id),
    content: '',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  await db.putNotebook(nb)
  return nb
}

function quoteLines(text: string) {
  return text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n')
}

export function locationLabel(a: Annotation, _doc: Doc, chapterTitle?: string): string {
  if (a.loc.kind === 'pdf') return `第 ${a.loc.page} 页`
  return chapterTitle ? `${chapterTitle}` : `第 ${a.loc.chapter + 1} 节`
}

export function annotationLink(a: Annotation): string {
  return `#/read/${a.docId}?a=${a.id}`
}

/** 一条批注写成笔记：原文引用（带回链）+ 问题 + 回答 */
export function annotationMarkdown(a: Annotation, doc: Doc, chapterTitle?: string): string {
  const where = locationLabel(a, doc, chapterTitle)
  const parts: string[] = []
  if (a.imageBlobId) parts.push(`![${doc.title} · ${where}](dr-blob:${a.imageBlobId})`)
  if (a.quote.trim()) parts.push(quoteLines(a.quote.slice(0, 1200)))
  parts.push(`[《${doc.title}》${where}](${annotationLink(a)})`)
  const q = a.question.trim() || MODE_LABEL[a.mode]
  parts.push(`**${q}**`)
  parts.push(a.answer.trim())
  return `${parts.join('\n\n')}\n\n---\n\n`
}

export async function appendToNotebook(notebookId: string, markdown: string): Promise<Notebook | null> {
  const nb = await db.getNotebook(notebookId)
  if (!nb) return null
  const sep = nb.content && !nb.content.endsWith('\n') ? '\n\n' : ''
  const next = { ...nb, content: `${nb.content}${sep}${markdown}`, updatedAt: Date.now() }
  await db.putNotebook(next)
  rememberNotebook(notebookId)
  return next
}
