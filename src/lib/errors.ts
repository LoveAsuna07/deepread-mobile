/** 收集最近的报错，设置页“复制问题报告”会带上，方便朋友反馈 bug */
const KEY = 'dr-error-log'
const MAX = 30

export interface ErrorEntry {
  at: string
  where: string
  message: string
}

function read(): ErrorEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function logError(where: string, err: unknown) {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(err)
  try {
    const list = read()
    list.push({ at: new Date().toISOString(), where, message: message.slice(0, 800) })
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    // 存不下就算了
  }
  console.error(`[${where}]`, err)
}

export function installErrorLog() {
  window.addEventListener('error', (e) => logError('window', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason))
}

export function errorLog(): ErrorEntry[] {
  return read()
}

export function clearErrorLog() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略
  }
}
