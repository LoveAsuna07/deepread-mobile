// 本地假模型服务：OpenAI 兼容的流式接口，只用于测试界面（不连真实模型）
// 用法：node scripts/mock-ai.mjs，设置里选“其他”，地址填 http://127.0.0.1:5199/v1，key 随便填
import http from 'node:http'

const ANSWER = `这段话在写**雨夜等车时的回忆**：

- “碎成一片一片的金色”是街灯倒映在积水里的样子，营造冷清又温暖的氛围；
- “那封没有寄出的信”是情节伏笔，暗示人物过去有一段没说出口的感情。

先看懂：第一章开头对车站的描写。`

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.end()
    if (!req.url?.endsWith('/chat/completions')) {
      res.statusCode = 404
      return res.end('not found')
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const auth = req.headers.authorization ?? ''
      if (auth === 'Bearer bad') {
        res.statusCode = 401
        return res.end('{"error":"invalid key"}')
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunks = ANSWER.match(/[\s\S]{1,6}/g) ?? []
      let i = 0
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          res.write('data: [DONE]\n\n')
          clearInterval(timer)
          return res.end()
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`)
      }, 30)
    })
  })
  .listen(5199, '127.0.0.1', () => console.log('mock ai on http://127.0.0.1:5199/v1'))
