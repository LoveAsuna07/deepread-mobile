import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { blobUrl } from '../lib/db'
import type { CoverColorId } from '../lib/types'

// ---------- 底部抽屉 ----------

let pendingBack: Promise<void> = Promise.resolve()

export function Sheet({
  open,
  onClose,
  title,
  right,
  children,
  tall,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  tall?: boolean
}) {
  // 手机返回键关闭抽屉：打开时压一条历史
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const marker = { drSheet: Math.random() }
    let popped = false
    let attached = false
    let cancelled = false
    const onPop = () => {
      popped = true
      closeRef.current()
    }
    // 上一个抽屉的 history.back() 还没生效时先等它，免得新抽屉被它关掉
    void pendingBack.then(() => {
      if (cancelled) return
      history.pushState(marker, '')
      window.addEventListener('popstate', onPop)
      attached = true
    })
    return () => {
      cancelled = true
      if (!attached) return
      window.removeEventListener('popstate', onPop)
      if (!popped && history.state === marker) {
        pendingBack = new Promise((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
        history.back()
      }
    }
  }, [open])

  if (!open) return null
  return (
    <>
      <div className="dr-sheet-backdrop" onClick={onClose} />
      <div className="dr-sheet" role="dialog" aria-modal="true" style={tall ? { height: '86dvh' } : undefined}>
        <div className="dr-sheet-grip" />
        {(title || right) && (
          <div className="flex min-h-11 flex-none items-center justify-between gap-3 px-4">
            <div className="min-w-0 truncate font-[var(--font-reading)] text-[17px] font-medium">{title}</div>
            {right}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  )
}

// ---------- 提示条 ----------

const ToastCtx = createContext<(msg: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef(0)
  const show = useCallback((m: string) => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2600)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="dr-toast" role="status" key={msg}>
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

// ---------- 封面 ----------

export const COLOR_VAR: Record<CoverColorId, string> = {
  cinnabar: 'var(--color-cover-cinnabar)',
  pine: 'var(--color-cover-pine)',
  indigo: 'var(--color-cover-indigo)',
  ochre: 'var(--color-cover-ochre)',
  moss: 'var(--color-cover-moss)',
  ink: 'var(--color-cover-ink)',
}

export function useBlobUrl(id?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    if (id) void blobUrl(id).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [id])
  return url
}

export function Cover({
  title,
  sub,
  color,
  blobId,
  className = '',
  titleSize = 14,
}: {
  title: string
  sub?: string
  color: CoverColorId
  blobId?: string
  className?: string
  titleSize?: number
}) {
  const url = useBlobUrl(blobId)
  return (
    <div className={`dr-cover ${className}`} style={{ background: COLOR_VAR[color] }}>
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="dr-cover-fallback">
          <b style={{ fontSize: titleSize }}>{title}</b>
          {sub && <span className="mt-auto text-[10px] opacity-80">{sub}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- 行内二次确认 ----------

export function ConfirmButton({
  label,
  confirmLabel = '确认删除',
  onConfirm,
  className = '',
  icon,
}: {
  label: string
  confirmLabel?: string
  onConfirm: () => void
  className?: string
  icon?: ReactNode
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  if (!armed)
    return (
      <button type="button" className={`dr-btn ${className}`} onClick={() => setArmed(true)}>
        {icon}
        {label}
      </button>
    )
  return (
    <span className="inline-flex items-center">
      <button type="button" className="dr-btn text-[var(--color-accent)]" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" className="dr-btn" onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  )
}
