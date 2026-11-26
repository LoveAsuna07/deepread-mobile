export type DocType = 'pdf' | 'epub' | 'txt'

export type CoverColorId = 'cinnabar' | 'pine' | 'indigo' | 'ochre' | 'moss' | 'ink'

export interface Doc {
  id: string
  type: DocType
  title: string
  author?: string
  /** PDF 页数；EPUB/TXT 为章节数 */
  pageCount: number
  coverColor: CoverColorId
  /** 封面图（EPUB 自带封面或 PDF 第一页缩略图）的 blob id */
  coverBlobId?: string
  createdAt: number
  lastOpenedAt: number
  /** PDF：页码（从 1 开始）；文本：章节下标 */
  lastPos?: number
  /** 文本类在章节内的滚动比例 0–1 */
  lastOffset?: number
  progress?: number
  /** 这本书自己的阅读设置（主题、字体、边距等），没有就用全局的 */
  reading?: ReadingSettings
}

/** EPUB / TXT 解析后的章节，html 已清洗；图片用 dr-blob:<id> 占位 */
export interface Chapter {
  title: string
  html: string
}

export interface DocContent {
  id: string
  /** PDF 原文件 */
  blobId?: string
  chapters?: Chapter[]
}

/** 框选位置。rect 均为 0–1 的相对坐标 */
export type AnnotationLoc =
  | { kind: 'pdf'; page: number; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'text'; chapter: number; block: number; offsetY: number }

export type AskMode = 'explain' | 'translate' | 'quiz' | 'custom'

export interface Annotation {
  id: string
  docId: string
  loc: AnnotationLoc
  quote: string
  /** 框选截图（只有 PDF 有） */
  imageBlobId?: string
  mode: AskMode
  question: string
  answer: string
  status: 'done' | 'error'
  error?: string
  createdAt: number
}

export interface Notebook {
  id: string
  title: string
  coverColor: CoverColorId
  content: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export interface AiSettings {
  provider: 'qwen' | 'deepseek' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  /** 看图模型，留空表示不支持截图提问 */
  visionModel: string
}

export type ReadingTheme = 'paper' | 'sepia' | 'green' | 'night'
export type ReadingTypeface = 'serif' | 'sans'
export type ReadingMargin = 'narrow' | 'medium' | 'wide'

export interface ReadingSettings {
  fontSize: number
  lineHeight: number
  theme?: ReadingTheme
  typeface?: ReadingTypeface
  margin?: ReadingMargin
}
