import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { COVER_COLORS } from '../lib/importers'
import type { CoverColorId } from '../lib/types'
import { COLOR_VAR, Cover, Sheet } from './ui'

/** 新建笔记本 / 改名换色共用 */
export default function NotebookDialog({
  open,
  onClose,
  onSubmit,
  initialTitle = '',
  initialColor = 'pine',
  submitLabel = '创建',
  heading = '新建笔记本',
}: {
  open: boolean
  onClose: () => void
  onSubmit: (title: string, color: CoverColorId) => void | Promise<void>
  initialTitle?: string
  initialColor?: CoverColorId
  submitLabel?: string
  heading?: string
}) {
  const [title, setTitle] = useState(initialTitle)
  const [color, setColor] = useState<CoverColorId>(initialColor)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setColor(initialColor)
      setBusy(false)
    }
  }, [open, initialTitle, initialColor])

  async function submit() {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(title.trim(), color)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={heading}>
      <form
        className="px-4 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex gap-4">
          <Cover title={title || '未命名'} color={color} className="h-[105px] w-[70px] flex-none" titleSize={11} />
          <div className="min-w-0 flex-1">
            <label className="text-[13px] text-[var(--color-ink-soft)]" htmlFor="nb-title">
              名字
            </label>
            <input
              id="nb-title"
              className="dr-input mt-1"
              value={title}
              maxLength={40}
              placeholder="比如：链表笔记"
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="mt-3 flex gap-2" role="radiogroup" aria-label="封面颜色">
              {COVER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-white"
                  style={{ background: COLOR_VAR[c], boxShadow: c === color ? '0 0 0 2px var(--color-paper), 0 0 0 3.5px var(--color-ink)' : undefined }}
                >
                  {c === color && <Check size={14} strokeWidth={2} />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="dr-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="dr-btn-solid" disabled={!title.trim() || busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
