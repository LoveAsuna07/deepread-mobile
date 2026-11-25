import { useEffect, useRef, type MutableRefObject } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { blobUrl, db, uid } from '../lib/db'
import { logError } from '../lib/errors'

/** 取编辑器里的最新内容（不等 onChange 的延迟）。卸载后仍返回最后一次内容 */
export type MarkdownGetter = MutableRefObject<(() => string | null) | null>

/** Obsidian 式 Markdown 编辑器：实时渲染、斜杠菜单；图片存进本地 blobs */
export default function MarkdownEditor({
  value,
  onChange,
  onLink,
  getter,
}: {
  value: string
  onChange: (md: string) => void
  onLink: (href: string) => boolean
  getter: MarkdownGetter
}) {
  {
    const rootRef = useRef<HTMLDivElement>(null)
    const crepeRef = useRef<Crepe | null>(null)
    const readyRef = useRef(false)
    /** 编辑器销毁前最后一次的内容，父组件卸载时保存要用 */
    const lastRef = useRef<string | null>(null)
    const onChangeRef = useRef(onChange)
    const onLinkRef = useRef(onLink)
    onChangeRef.current = onChange
    onLinkRef.current = onLink

    // 不随卸载清空：父组件卸载时的保存可能晚于编辑器销毁
    getter.current = () => (readyRef.current && crepeRef.current ? crepeRef.current.getMarkdown() : lastRef.current)

    useEffect(() => {
      const root = rootRef.current
      if (!root) return
      const crepe = new Crepe({
        root,
        defaultValue: value,
        features: {
          [Crepe.Feature.TopBar]: false,
          [Crepe.Feature.AI]: false,
          [Crepe.Feature.Latex]: false,
        },
        featureConfigs: {
          [Crepe.Feature.Placeholder]: { text: '写点什么，输入 / 插入标题、列表、表格…', mode: 'doc' },
          [Crepe.Feature.ImageBlock]: {
            onUpload: async (file: File) => {
              const id = uid()
              await db.putBlob(id, file)
              return `dr-blob:${id}`
            },
            proxyDomURL: async (url: string) => {
              if (!url.startsWith('dr-blob:')) return url
              return (await blobUrl(url.slice('dr-blob:'.length))) ?? ''
            },
          },
        },
      })
      crepe.on((api) => {
        api.markdownUpdated((_ctx, md) => onChangeRef.current(md))
      })
      crepeRef.current = crepe
      let destroyed = false
      crepe
        .create()
        .then(() => {
          if (destroyed) void crepe.destroy()
          else readyRef.current = true
        })
        .catch((e) => logError('editor.create', e))

      // 笔记里的回链（#/read/...）直接跳回原文，不弹链接编辑框
      const onClick = (e: MouseEvent) => {
        const a = (e.target as HTMLElement).closest('a')
        const href = a?.getAttribute('href') ?? ''
        if (href && onLinkRef.current(href)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
      root.addEventListener('click', onClick, true)
      return () => {
        destroyed = true
        root.removeEventListener('click', onClick, true)
        if (readyRef.current) {
          try {
            lastRef.current = crepe.getMarkdown()
          } catch {
            // 忽略
          }
          void crepe.destroy()
        }
        readyRef.current = false
        crepeRef.current = null
      }
      // 只在挂载时读取初始内容
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return <div ref={rootRef} className="dr-note" />
  }
}
