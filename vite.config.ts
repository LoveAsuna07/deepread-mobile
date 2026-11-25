import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // 相对路径：部署到 GitHub Pages 子目录或任何静态托管都能用
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '深读',
        short_name: '深读',
        description: '框住看不懂的地方直接问，问过的地方变成笔记。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf9f5',
        theme_color: '#faf9f5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 字体（中文字体被拆成两百多个小文件）和 pdf.js 的字形表不预缓存：用到哪个下哪个，下过就存着
        globPatterns: ['**/*.{js,css,html,svg,png,mjs}'],
        globIgnores: ['pdfjs/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\.(woff2?|ttf)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'dr-fonts', expiration: { maxEntries: 400 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'dr-pdfjs', expiration: { maxEntries: 300 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
})
