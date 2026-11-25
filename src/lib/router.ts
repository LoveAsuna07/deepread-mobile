import { useEffect, useState } from 'react'

export interface Route {
  name: 'shelf' | 'read' | 'note' | 'settings'
  id?: string
  query: URLSearchParams
}

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, qs = ''] = raw.split('?')
  const query = new URLSearchParams(qs)
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'read' && parts[1]) return { name: 'read', id: decodeURIComponent(parts[1]), query }
  if (parts[0] === 'note' && parts[1]) return { name: 'note', id: decodeURIComponent(parts[1]), query }
  if (parts[0] === 'settings') return { name: 'settings', query }
  return { name: 'shelf', query }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash())
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(path: string, replace = false) {
  const hash = `#${path}`
  if (replace) location.replace(hash)
  else location.hash = hash
}

/** 返回上一页；直接打开深链接时没有历史，就回书架 */
let navCount = 0
window.addEventListener('hashchange', () => {
  navCount += 1
})

export function back() {
  if (navCount > 0) history.back()
  else go('/', true)
}
