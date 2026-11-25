import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookmarkPlus, ImageIcon, RotateCcw, Settings } from 'lucide-react'
import { Sheet } from '../components/ui'
import { AiError, buildMessages, MODE_LABEL, streamChat } from '../lib/ai'
import { db, uid } from '../lib/db'
import { logError } from '../lib/errors'
import { mdToHtml } from '../lib/format'
import { go } from '../lib/router'
import type { AiSettings, Annotation, AskMode, Doc } from '../lib/types'
import type { Draft } from './types'

const MODES: AskMode[] = ['explain', 'translate', 'quiz']

export default function AskSheet({
  doc,
  draft,
  ai,
  onClose,
  onSaved,
  onSaveToNote,
}: {
  doc: Doc
  draft: Draft | null
  ai: AiSettings
  onClose: () => void
  onSaved: (a: Annotation, replaces?: string) => void
  onSaveToNote: (a: Annotation) => void
}) {
  const [question, setQuestion] = useState('')
  const [withImage, setWithImage] = useState(false)
  const [answer, setAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Annotation | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const canImage = Boolean(draft?.image && ai.visionModel)

  useEffect(() => {
    abortRef.current?.abort()
    setQuestion('')
    setAnswer('')
    setError('')
    setSaved(null)
    setStreaming(false)
    // 框里字很少（公式、图表）时默认带上截图
    setWithImage(Boolean(draft?.image && ai.visionModel && draft.quote.replace(/\s/g, '').length < 40))
  }, [draft, ai.visionModel])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask(mode: AskMode) {
    if (!draft || streaming) return
    const q = mode === 'custom' ? question.trim() : ''
    if (mode === 'custom' && !q) {
      inputRef.current?.focus()
      return
    }
    abortRef.current?.abort()
    const prevId = saved?.id
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    setError('')
    setAnswer('')
    setSaved(null)
    const image = withImage && canImage ? draft.image : undefined
    try {
      const messages = buildMessages({
        docTitle: doc.title,
        location: draft.location,
        context: draft.context,
        quote: draft.quote,
        image,
        mode,
        question: q,
      })
      const text = await streamChat(ai, messages, { vision: Boolean(image), signal: ctrl.signal, onDelta: setAnswer })
      let imageBlobId: string | undefined
      if (draft.image && (image || !draft.quote.trim())) {
        imageBlobId = uid()
        await db.putBlob(imageBlobId, await (await fetch(draft.image)).blob())
      }
      const annotation: Annotation = {
        id: uid(),
        docId: doc.id,
        loc: draft.loc,
        quote: draft.quote,
        imageBlobId,
        mode,
        question: q,
        answer: text,
        status: 'done',
        createdAt: Date.now(),
      }
      await db.putAnnotation(annotation)
      if (prevId) await db.deleteAnnotation(prevId)
      setSaved(annotation)
      onSaved(annotation, prevId)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (!(err instanceof AiError)) logError('ask', err)
      setError(err instanceof Error ? err.message : '提问失败')
    } finally {
      if (abortRef.current === ctrl) setStreaming(false)
    }
  }

  const noKey = !ai.apiKey.trim()

  return (
    <Sheet open={!!draft} onClose={onClose} title={draft?.location ?? ''} tall={Boolean(answer || streaming)}>
      {draft && (
        <div className="px-4 pb-4">
          <p className="dr-quote line-clamp-4 whitespace-pre-line">{draft.quote || '（框里没有文字）'}</p>
          {draft.image && (
            <div className="mt-3 flex items-center gap-3">
              <img src={draft.image} alt="框选区域" className="h-14 max-w-[45%] rounded border border-[var(--color-line)] object-contain" />
              {canImage ? (
                <label className="flex items-center gap-2 text-[14px] text-[var(--color-ink-soft)]">
                  <input type="checkbox" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
                  <ImageIcon size={15} strokeWidth={1.5} />
                  把截图也发给 AI
                </label>
              ) : (
                <span className="text-[13px] leading-5 text-[var(--color-muted)]">当前模型看不了图，只发文字</span>
              )}
            </div>
          )}

          {noKey ? (
            <div className="mt-4 rounded-xl border border-[var(--color-line)] p-4">
              <p className="text-[15px]">还没有填 AI 的 API key</p>
              <p className="mt-1 text-[13px] leading-5 text-[var(--color-ink-soft)]">填好之后就能对框住的内容提问。key 只存在这台手机上。</p>
              <button type="button" className="dr-btn-solid mt-3" onClick={() => go('/settings')}>
                <Settings size={17} strokeWidth={1.5} />
                去设置
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 flex gap-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={streaming}
                    onClick={() => void ask(m)}
                    className="h-9 rounded-lg border border-[var(--color-line-strong)] px-4 text-[14px] text-[var(--color-ink-soft)] active:bg-[var(--color-hover)] disabled:opacity-40"
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
              <form
                className="mt-3 flex items-end gap-2 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-2 pl-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void ask('custom')
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="想问什么？"
                  className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-6 outline-none"
                />
                <button type="submit" className="dr-send" aria-label="发送" disabled={streaming || !question.trim()}>
                  <ArrowUp size={18} strokeWidth={2} />
                </button>
              </form>
            </>
          )}

          {(answer || streaming) && (
            <div className="mt-5 border-t border-[var(--color-line)] pt-4">
              <div
                className={`dr-answer${streaming ? ' dr-caret' : ''}`}
                dangerouslySetInnerHTML={{ __html: answer ? mdToHtml(answer) : '' }}
              />
              {streaming && !answer && <p className="text-[14px] text-[var(--color-ink-soft)]">正在想…</p>}
            </div>
          )}
          {error && (
            <div className="mt-4 border-l-2 border-[var(--color-accent)] pl-3">
              <p className="text-[14px] leading-6">{error}</p>
              {/key|设置/.test(error) && (
                <button type="button" className="dr-btn -ml-2 mt-1" onClick={() => go('/settings')}>
                  <Settings size={16} strokeWidth={1.5} />
                  去设置
                </button>
              )}
            </div>
          )}
          {saved && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[13px] text-[var(--color-success)]">已存成批注</span>
              <div className="flex">
                <button type="button" className="dr-btn" onClick={() => void ask(saved.mode)}>
                  <RotateCcw size={16} strokeWidth={1.5} />
                  重答
                </button>
                <button type="button" className="dr-btn" onClick={() => onSaveToNote(saved)}>
                  <BookmarkPlus size={16} strokeWidth={1.5} />
                  存到笔记
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
