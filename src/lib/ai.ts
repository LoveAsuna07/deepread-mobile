import { db } from './db'
import type { AiSettings, AskMode } from './types'

export const PROVIDERS: Record<AiSettings['provider'], { label: string; baseUrl: string; model: string; visionModel: string; keyUrl: string }> = {
  qwen: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    visionModel: 'qwen-vl-plus',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    visionModel: '',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  custom: {
    label: '其他（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    visionModel: '',
    keyUrl: '',
  },
}

const KEY = 'ai-settings'

export function defaultAiSettings(): AiSettings {
  const p = PROVIDERS.qwen
  return { provider: 'qwen', baseUrl: p.baseUrl, apiKey: '', model: p.model, visionModel: p.visionModel }
}

export async function loadAiSettings(): Promise<AiSettings> {
  return { ...defaultAiSettings(), ...((await db.getKv<AiSettings>(KEY)) ?? {}) }
}

export async function saveAiSettings(s: AiSettings) {
  await db.putKv(KEY, s)
}

export const MODE_LABEL: Record<AskMode, string> = {
  explain: '解释',
  translate: '翻译',
  quiz: '出题',
  custom: '提问',
}

const MODE_RULES: Record<AskMode, string> = {
  explain: '解释框内内容在讲什么、为什么这样表述，必要时点出它和上下文的关系。',
  translate: '先把框内内容翻译成{{target}}，再补一句术语或表达上的说明。',
  quiz: '基于框内内容出一道单选题：给出题干、A–D 四个选项，最后单独一行写“答案：X”和一句解析。',
  custom: '按用户的问题作答。',
}

const SYSTEM = `你是「深读」的阅读助教。用户正在手机上读一份文档，框选了一段内容并向你提问。结合给出的上下文原文回答。

规则：
1. 直接回答，简体中文，150–350 字，可用 Markdown 短列表；不要复述问题，不要寒暄。
2. 只依据给定材料和常识，不要编造材料里没有的具体事实；材料不足就直说缺什么。
3. 如果答案依赖前文某个概念，在末尾用一行“先看懂：概念名”提示。`

export interface AskInput {
  docTitle: string
  location: string
  context: string
  quote: string
  image?: string
  mode: AskMode
  question: string
}

export function buildMessages(input: AskInput) {
  const target = /[一-龥]/.test(input.quote) ? '英文' : '中文'
  const rule = MODE_RULES[input.mode].replace('{{target}}', target)
  const text = `【文档】${input.docTitle}
【位置】${input.location}

【上下文原文】
${input.context.slice(0, 12000) || '（无）'}

【框选的内容】
"""${input.quote || '（框内没有可提取的文字，请看截图）'}"""

【问题】${input.question || '请解释这段内容'}

【本次任务】${rule}`
  const content = input.image
    ? [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: input.image } },
      ]
    : text
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content },
  ]
}

export class AiError extends Error {}

function explainStatus(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API key 无效或没有权限，去“设置”里检查一下。'
  if (status === 402 || /insufficient|余额|quota|Arrearage/i.test(body)) return '账户余额或额度不足。'
  if (status === 404) return '模型名或接口地址不对，去“设置”里检查一下。'
  if (status === 429) return '请求太频繁，稍等几秒再试。'
  if (status >= 500) return '模型服务暂时出错，稍后再试。'
  return `请求失败（${status}）`
}

/** 流式调用 OpenAI 兼容接口，逐段回调正文 */
export async function streamChat(
  settings: AiSettings,
  messages: unknown[],
  opts: { vision?: boolean; signal?: AbortSignal; onDelta: (text: string) => void },
): Promise<string> {
  if (!settings.apiKey.trim()) throw new AiError('还没有填 API key。去“设置”里填一下就能提问。')
  const model = opts.vision && settings.visionModel ? settings.visionModel : settings.model
  if (!settings.baseUrl || !model) throw new AiError('接口地址或模型名没填，去“设置”里补上。')
  let res: Response
  try {
    res = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.4 }),
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new AiError('连不上模型服务，检查一下网络。')
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new AiError(explainStatus(res.status, body))
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta: string = json.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          full += delta
          opts.onDelta(full)
        }
      } catch {
        // 半截 JSON，等下一块
      }
    }
  }
  if (!full.trim()) throw new AiError('模型没有返回内容，换个问法再试。')
  return full
}

/** 设置页的“测试连接” */
export async function testConnection(settings: AiSettings): Promise<string> {
  const text = await streamChat(
    settings,
    [{ role: 'user', content: '只回复两个字：可用' }],
    { onDelta: () => undefined },
  )
  return text.trim().slice(0, 20)
}
