import DOMPurify from 'dompurify'
import { marked } from 'marked'

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const pad3 = (n: number) => String(n).padStart(3, '0')

export function mdToHtml(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false, breaks: true }) as string)
}

export const TYPE_LABEL = { pdf: 'PDF', epub: 'EPUB', txt: 'TXT' } as const

export function wordCount(md: string): number {
  const text = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*_`~\-[\]()|]/g, '')
  const cjk = text.match(/[一-龥]/g)?.length ?? 0
  const words = text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0
  return cjk + words
}
