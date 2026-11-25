import { useEffect, useRef, useState, type RefObject } from 'react'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const LONG_PRESS_MS = 380
const MOVE_TOLERANCE = 10
const MIN_BOX = 14

function toBox(x0: number, y0: number, x1: number, y1: number): Box {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
}

/**
 * 框选手势：
 * - 手指长按 0.38 秒后拖动画框；没到时间就移动则当作正常滚动
 * - force 为 true（点了工具栏“框选”）时一按下就开始画框
 * - 鼠标：按住 Alt 拖，或长按后拖
 * 松手后回调视口坐标的矩形；返回值里的 box/ring 用于绘制
 */
export function useBoxSelect(
  ref: RefObject<HTMLElement | null>,
  opts: { force: boolean; ready?: boolean; onBox: (box: Box) => void; onCancel?: () => void },
) {
  const [box, setBox] = useState<Box | null>(null)
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  /** 刚刚完成一次框选，用来吞掉随后的 click */
  const justSelected = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer = 0
    let ringTimer = 0
    let start: { x: number; y: number } | null = null
    let selecting = false
    let last: Box | null = null

    const begin = (x: number, y: number) => {
      window.clearTimeout(ringTimer)
      selecting = true
      setRing(null)
      last = toBox(x, y, x, y)
      setBox(last)
      navigator.vibrate?.(12)
    }
    const finish = () => {
      window.clearTimeout(timer)
      window.clearTimeout(ringTimer)
      setRing(null)
      if (selecting) {
        selecting = false
        justSelected.current = true
        window.setTimeout(() => (justSelected.current = false), 350)
        if (last && last.width >= MIN_BOX && last.height >= MIN_BOX) {
          optsRef.current.onBox(last)
        } else {
          setBox(null)
          optsRef.current.onCancel?.()
        }
      }
      start = null
    }

    // ---- 触摸 ----
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        window.clearTimeout(timer)
        window.clearTimeout(ringTimer)
        setRing(null)
        start = null
        return
      }
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      if (optsRef.current.force) {
        begin(t.clientX, t.clientY)
        return
      }
      // 圆环晚一点出现，普通点击和滑动时不闪
      ringTimer = window.setTimeout(() => setRing({ x: t.clientX, y: t.clientY }), 120)
      timer = window.setTimeout(() => {
        if (start) begin(start.x, start.y)
      }, LONG_PRESS_MS)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!start) return
      const t = e.touches[0]
      if (selecting) {
        e.preventDefault()
        last = toBox(start.x, start.y, t.clientX, t.clientY)
        setBox(last)
        return
      }
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE) {
        window.clearTimeout(timer)
        window.clearTimeout(ringTimer)
        setRing(null)
        start = null
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (selecting && start && t) last = toBox(start.x, start.y, t.clientX, t.clientY)
      finish()
    }

    // ---- 鼠标（电脑上调试或使用）----
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      start = { x: e.clientX, y: e.clientY }
      if (e.altKey || optsRef.current.force) {
        e.preventDefault()
        begin(e.clientX, e.clientY)
        return
      }
      timer = window.setTimeout(() => {
        if (start) begin(start.x, start.y)
      }, LONG_PRESS_MS)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!start) return
      if (selecting) {
        last = toBox(start.x, start.y, e.clientX, e.clientY)
        setBox(last)
      } else if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) {
        window.clearTimeout(timer)
        start = null
      }
    }
    const onMouseUp = (e: MouseEvent) => {
      if (selecting && start) last = toBox(start.x, start.y, e.clientX, e.clientY)
      if (start || selecting) finish()
    }
    const onContext = (e: Event) => e.preventDefault()

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    el.addEventListener('contextmenu', onContext)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(ringTimer)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('contextmenu', onContext)
    }
  }, [ref, opts.ready])

  return { box, ring, clearBox: () => setBox(null), justSelected }
}
