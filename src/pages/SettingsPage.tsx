import { useEffect, useState } from 'react'
import { ChevronLeft, ClipboardCopy, ExternalLink, Eye, EyeOff, PlugZap } from 'lucide-react'
import { ConfirmButton, useToast } from '../components/ui'
import { AiError, defaultAiSettings, loadAiSettings, PROVIDERS, saveAiSettings, testConnection } from '../lib/ai'
import { db } from '../lib/db'
import { clearErrorLog, errorLog } from '../lib/errors'
import { back } from '../lib/router'
import type { AiSettings } from '../lib/types'

const VERSION = '0.1.0'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-[var(--font-reading)] text-[17px] font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="text-[14px] text-[var(--color-ink-soft)]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[12px] leading-5 text-[var(--color-muted)]">{hint}</span>}
    </label>
  )
}

export default function SettingsPage() {
  const [s, setS] = useState<AiSettings>(defaultAiSettings())
  const [loaded, setLoaded] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [usage, setUsage] = useState('')
  const toast = useToast()

  useEffect(() => {
    void loadAiSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`)
    })
  }, [])

  function update(patch: Partial<AiSettings>) {
    const next = { ...s, ...patch }
    setS(next)
    setTestMsg(null)
    void saveAiSettings(next)
  }

  function pickProvider(p: AiSettings['provider']) {
    const preset = PROVIDERS[p]
    update({
      provider: p,
      baseUrl: p === 'custom' ? s.baseUrl : preset.baseUrl,
      model: p === 'custom' ? s.model : preset.model,
      visionModel: p === 'custom' ? s.visionModel : preset.visionModel,
    })
  }

  async function test() {
    setTesting(true)
    setTestMsg(null)
    try {
      const reply = await testConnection(s)
      setTestMsg({ ok: true, text: `连上了，模型回复：${reply}` })
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof AiError ? e.message : `出错了：${(e as Error).message}` })
    } finally {
      setTesting(false)
    }
  }

  async function copyReport() {
    const docs = await db.allDocs().catch(() => [])
    const lines = [
      `深读 手机版 v${VERSION}`,
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `设备：${navigator.userAgent}`,
      `屏幕：${screen.width}×${screen.height} @${devicePixelRatio}x，窗口 ${innerWidth}×${innerHeight}`,
      `安装到主屏幕：${matchMedia('(display-mode: standalone)').matches ? '是' : '否'}`,
      `书：${docs.length} 本（${docs.map((d) => d.type).join(', ')}）`,
      `模型：${PROVIDERS[s.provider].label} / ${s.model}${s.visionModel ? ` / ${s.visionModel}` : ''}，key ${s.apiKey ? '已填' : '未填'}`,
      '',
      '最近的报错：',
      ...errorLog().map((e) => `[${e.at}] ${e.where}: ${e.message}`),
      '',
      '我遇到的问题：（在这里写一下你点了什么、看到了什么）',
    ]
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制，粘贴发给开发者就行')
    } catch {
      // 剪贴板不可用（比如 http 页面）：退回到选中文本
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      toast('已复制')
    }
  }

  const preset = PROVIDERS[s.provider]
  const standalone = typeof window !== 'undefined' && matchMedia('(display-mode: standalone)').matches
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div className="min-h-full bg-[var(--color-paper)] pb-[calc(40px+var(--safe-bottom))]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-paper)] pt-[var(--safe-top)]">
        <div className="flex h-12 items-center px-1">
          <button type="button" className="dr-btn" aria-label="返回" onClick={back}>
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>
          <h1 className="font-[var(--font-reading)] text-[17px] font-medium">设置</h1>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-4">
        <Section title="AI 模型">
          <p className="text-[14px] leading-6 text-[var(--color-ink-soft)]">
            提问要用你自己的 API key。key 只存在这台手机的浏览器里，直接发给模型服务商，不经过别的服务器。
          </p>
          <div className="dr-tabs mt-3" role="radiogroup" aria-label="服务商">
            {(Object.keys(PROVIDERS) as AiSettings['provider'][]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={s.provider === p} className={`dr-tab${s.provider === p ? ' is-on' : ''}`} onClick={() => pickProvider(p)}>
                {PROVIDERS[p].label}
              </button>
            ))}
          </div>

          <Field label="API key">
            <div className="flex gap-2">
              <input
                className="dr-input"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                value={s.apiKey}
                disabled={!loaded}
                onChange={(e) => update({ apiKey: e.target.value.trim() })}
              />
              <button type="button" className="dr-btn flex-none" aria-label={showKey ? '隐藏' : '显示'} onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff size={18} strokeWidth={1.5} /> : <Eye size={18} strokeWidth={1.5} />}
              </button>
            </div>
          </Field>
          {preset.keyUrl && (
            <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-[var(--color-accent)]">
              去{preset.label}申请 key
              <ExternalLink size={13} strokeWidth={1.5} />
            </a>
          )}

          <Field label="接口地址" hint="OpenAI 兼容格式，填到 /v1 这一级（DeepSeek 不带 /v1）">
            <input className="dr-input" value={s.baseUrl} spellCheck={false} onChange={(e) => update({ baseUrl: e.target.value.trim() })} />
          </Field>
          <Field label="文字模型">
            <input className="dr-input" value={s.model} spellCheck={false} onChange={(e) => update({ model: e.target.value.trim() })} />
          </Field>
          <Field label="看图模型" hint="PDF 框住公式、图表时用。留空表示只发文字。DeepSeek 目前没有看图模型。">
            <input className="dr-input" value={s.visionModel} spellCheck={false} onChange={(e) => update({ visionModel: e.target.value.trim() })} />
          </Field>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" className="dr-btn-solid" disabled={testing || !s.apiKey} onClick={() => void test()}>
              <PlugZap size={17} strokeWidth={1.5} />
              {testing ? '测试中…' : '测试连接'}
            </button>
          </div>
          {testMsg && (
            <p className={`mt-3 border-l-2 pl-3 text-[14px] leading-6 ${testMsg.ok ? 'border-[var(--color-success)]' : 'border-[var(--color-accent)]'}`}>
              {testMsg.text}
            </p>
          )}
        </Section>

        {!standalone && (
          <Section title="装到手机桌面">
            <p className="text-[14px] leading-6 text-[var(--color-ink-soft)]">
              {ios
                ? '用 Safari 打开这个页面，点底部的“分享”按钮，选“添加到主屏幕”。之后从桌面图标打开，就是全屏的 app，没网也能看已导入的书。'
                : '用 Chrome 或 Edge 打开这个页面，点右上角菜单里的“安装应用”或“添加到主屏幕”。之后从桌面图标打开，就是全屏的 app，没网也能看已导入的书。'}
            </p>
          </Section>
        )}

        <Section title="遇到问题">
          <p className="text-[14px] leading-6 text-[var(--color-ink-soft)]">
            点下面的按钮会复制一份问题报告（手机型号、最近的报错，不含 key 和书的内容），粘贴发给开发者，再补一句你做了什么。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="dr-btn-solid" onClick={() => void copyReport()}>
              <ClipboardCopy size={17} strokeWidth={1.5} />
              复制问题报告
            </button>
            <button
              type="button"
              className="dr-btn"
              onClick={() => {
                clearErrorLog()
                toast('已清空报错记录')
              }}
            >
              清空报错记录
            </button>
          </div>
        </Section>

        <Section title="数据">
          <p className="text-[14px] leading-6 text-[var(--color-ink-soft)]">
            书、批注和笔记都只存在这台手机的浏览器里{usage ? `，现在占用 ${usage}` : ''}。清除浏览器数据或卸载会一起删掉。
          </p>
          <div className="-ml-2 mt-2">
            <ConfirmButton
              label="清空所有数据"
              confirmLabel="确认清空"
              onConfirm={() => {
                indexedDB.deleteDatabase('deepread-mobile')
                try {
                  localStorage.clear()
                } catch {
                  // 忽略
                }
                location.replace(location.pathname)
              }}
            />
          </div>
        </Section>

        <p className="num mt-10 text-center text-[12px] text-[var(--color-muted)]">深读 手机版 v{VERSION}</p>
      </main>
    </div>
  )
}
