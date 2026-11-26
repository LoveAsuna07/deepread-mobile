import { lazy, Suspense } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import Splash from './components/Splash'
import { ToastProvider } from './components/ui'
import { useRoute } from './lib/router'
import ShelfPage from './pages/ShelfPage'

const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const NotebookPage = lazy(() => import('./pages/NotebookPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function UpdateBar() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="dr-toast flex items-center gap-3" role="status">
      <span>有新版本</span>
      <button type="button" className="font-medium text-[var(--color-pin)]" onClick={() => void updateServiceWorker(true)}>
        立即更新
      </button>
      <button type="button" className="opacity-70" onClick={() => setNeedRefresh(false)}>
        稍后
      </button>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  return (
    <ToastProvider>
      <Suspense fallback={<div className="p-6 text-[14px] text-[var(--color-ink-soft)]">正在打开…</div>}>
        {route.name === 'read' && route.id ? (
          <ReaderPage key={route.id} docId={route.id} query={route.query} />
        ) : route.name === 'note' && route.id ? (
          <NotebookPage key={route.id} notebookId={route.id} />
        ) : route.name === 'settings' ? (
          <SettingsPage />
        ) : (
          <ShelfPage />
        )}
      </Suspense>
      <UpdateBar />
      <Splash />
    </ToastProvider>
  )
}
