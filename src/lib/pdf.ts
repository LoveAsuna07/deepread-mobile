import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const assetBase = new URL('./pdfjs/', document.baseURI).href

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    isEvalSupported: false,
  }).promise
}

export interface PdfTextItem {
  str: string
  /** 相对页面的 0–1 坐标，左上角为原点 */
  x: number
  y: number
  w: number
  h: number
}

const textCache = new WeakMap<PDFDocumentProxy, Map<number, PdfTextItem[]>>()

/** 取一页的文字及位置（按页缓存） */
export async function pageTextItems(pdf: PDFDocumentProxy, pageNo: number): Promise<PdfTextItem[]> {
  let cache = textCache.get(pdf)
  if (!cache) {
    cache = new Map()
    textCache.set(pdf, cache)
  }
  const hit = cache.get(pageNo)
  if (hit) return hit
  const page = await pdf.getPage(pageNo)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: PdfTextItem[] = []
  for (const raw of content.items) {
    if (!('str' in raw) || !raw.str) continue
    const [, , , d, e, f] = raw.transform as number[]
    const fontH = Math.abs(d) || raw.height || 10
    // PDF 坐标原点在左下，换成左上
    const [x, yTop] = viewport.convertToViewportPoint(e, f + fontH)
    items.push({
      str: raw.str,
      x: x / viewport.width,
      y: yTop / viewport.height,
      w: (raw.width || 0) / viewport.width,
      h: fontH / viewport.height,
    })
  }
  cache.set(pageNo, items)
  return items
}

export async function pageText(pdf: PDFDocumentProxy, pageNo: number): Promise<string> {
  const items = await pageTextItems(pdf, pageNo)
  return joinItems(items)
}

/** 把文字块按行拼起来：y 接近的算同一行 */
export function joinItems(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) < 0.006 ? a.x - b.x : a.y - b.y))
  let out = ''
  let lastY = -1
  for (const it of sorted) {
    if (lastY >= 0 && Math.abs(it.y - lastY) >= 0.006) out += '\n'
    out += it.str
    lastY = it.y
  }
  return out.replace(/[ \t]+\n/g, '\n').trim()
}

/** 取相对矩形内的文字：文字块中心落在框里就算 */
export async function textInRect(
  pdf: PDFDocumentProxy,
  pageNo: number,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const items = await pageTextItems(pdf, pageNo)
  const inside = items.filter((it) => {
    const cx = it.x + it.w / 2
    const cy = it.y + it.h / 2
    return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h
  })
  return joinItems(inside)
}

export async function renderThumb(pdf: PDFDocumentProxy, width = 360): Promise<Blob | null> {
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return await new Promise((r) => canvas.toBlob((b) => r(b), 'image/webp', 0.82))
  } catch {
    return null
  }
}
