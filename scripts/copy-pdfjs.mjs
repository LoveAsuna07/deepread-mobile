// 把 pdf.js 的字符映射表和标准字体复制到 public/pdfjs，中文 PDF 渲染需要它们
import { cp, mkdir } from 'node:fs/promises'

const from = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const to = new URL('../public/pdfjs/', import.meta.url)
await mkdir(to, { recursive: true })
await cp(new URL('cmaps/', from), new URL('cmaps/', to), { recursive: true })
await cp(new URL('standard_fonts/', from), new URL('standard_fonts/', to), { recursive: true })
console.log('pdfjs assets copied')
