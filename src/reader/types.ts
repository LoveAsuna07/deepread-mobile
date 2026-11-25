import type { Annotation, AnnotationLoc } from '../lib/types'
import type { Box } from './useBoxSelect'

/** 一次框选的结果，送进提问抽屉 */
export interface Draft {
  loc: AnnotationLoc
  quote: string
  /** PDF 框选区域截图 data URL */
  image?: string
  /** 给模型的上下文原文 */
  context: string
  /** 给人看的位置，例如“第 12 页” */
  location: string
}

export interface ViewHandle {
  /** 把视口矩形转成框选结果；框里什么都没有时返回 null */
  resolveBox: (box: Box) => Promise<Draft | null>
  jumpTo: (loc: AnnotationLoc, flash?: boolean) => void
}

export interface ViewProps {
  annotations: Annotation[]
  onOpenAnnotation: (id: string) => void
  onProgress: (pos: number, offset: number, progress: number) => void
  onLabel: (label: string) => void
}
