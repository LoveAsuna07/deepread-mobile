import type { Annotation, Doc, DocContent, Notebook } from './types'

const DB_NAME = 'deepread-mobile'
const VERSION = 1
const STORES = ['docs', 'contents', 'annotations', 'notebooks', 'blobs', 'kv'] as const
type Store = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue
        if (name === 'blobs' || name === 'kv') db.createObjectStore(name)
        else {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          if (name === 'annotations') store.createIndex('docId', 'docId')
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(
  store: Store,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

const getAll = <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
const get = <T>(store: Store, key: string) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
const put = (store: Store, value: unknown, key?: string) =>
  run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)))
const del = (store: Store, key: string) => run(store, 'readwrite', (s) => s.delete(key))

export const db = {
  allDocs: () => getAll<Doc>('docs'),
  getDoc: (id: string) => get<Doc>('docs', id),
  putDoc: (doc: Doc) => put('docs', doc),
  async patchDoc(id: string, patch: Partial<Doc>) {
    const doc = await get<Doc>('docs', id)
    if (doc) await put('docs', { ...doc, ...patch })
  },
  getContent: (id: string) => get<DocContent>('contents', id),
  putContent: (c: DocContent) => put('contents', c),

  async annotationsOf(docId: string): Promise<Annotation[]> {
    const db = await open()
    return new Promise((resolve, reject) => {
      const req = db.transaction('annotations').objectStore('annotations').index('docId').getAll(docId)
      req.onsuccess = () =>
        resolve((req.result as Annotation[]).sort((a, b) => a.createdAt - b.createdAt))
      req.onerror = () => reject(req.error)
    })
  },
  allAnnotations: () => getAll<Annotation>('annotations'),
  putAnnotation: (a: Annotation) => put('annotations', a),
  deleteAnnotation: (id: string) => del('annotations', id),

  allNotebooks: () => getAll<Notebook>('notebooks'),
  getNotebook: (id: string) => get<Notebook>('notebooks', id),
  putNotebook: (n: Notebook) => put('notebooks', n),
  deleteNotebook: (id: string) => del('notebooks', id),

  getBlob: (id: string) => get<Blob>('blobs', id),
  putBlob: (id: string, blob: Blob) => put('blobs', blob, id),
  deleteBlob: (id: string) => del('blobs', id),

  getKv: <T>(key: string) => get<T>('kv', key),
  putKv: (key: string, value: unknown) => put('kv', value, key),

  /** 删除一本书和它的所有数据 */
  async deleteDoc(id: string) {
    const content = await get<DocContent>('contents', id)
    const doc = await get<Doc>('docs', id)
    const notes = await this.annotationsOf(id)
    const blobIds = new Set<string>()
    if (content?.blobId) blobIds.add(content.blobId)
    if (doc?.coverBlobId) blobIds.add(doc.coverBlobId)
    for (const ch of content?.chapters ?? []) {
      for (const m of ch.html.matchAll(/dr-blob:([\w-]+)/g)) blobIds.add(m[1])
    }
    for (const a of notes) {
      if (a.imageBlobId) blobIds.add(a.imageBlobId)
      await del('annotations', a.id)
    }
    for (const b of blobIds) await del('blobs', b)
    await del('contents', id)
    await del('docs', id)
  },
}

/** 请求持久化存储，避免手机浏览器在空间紧张时清掉书 */
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // 不支持时忽略
  }
}

const urlCache = new Map<string, string>()
export async function blobUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id)
  if (hit) return hit
  const blob = await db.getBlob(id)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
