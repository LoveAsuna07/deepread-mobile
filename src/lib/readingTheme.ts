import type { CSSProperties } from 'react'
import type { ReadingMargin, ReadingSettings, ReadingTheme, ReadingTypeface } from './types'

export const DEFAULT_READING: Required<ReadingSettings> = {
  fontSize: 18,
  lineHeight: 1.85,
  theme: 'paper',
  typeface: 'serif',
  margin: 'medium',
}

interface ThemeSpec {
  id: ReadingTheme
  label: string
  background: string
  text: string
  soft: string
  muted: string
  line: string
  lineStrong: string
  hover: string
  sidebar: string
}

/** 和桌面版同一套四种背景 */
export const READING_THEMES: ThemeSpec[] = [
  {
    id: 'paper',
    label: '纸白',
    background: '#faf9f5',
    text: '#1f1e1b',
    soft: '#5d5a53',
    muted: '#8f8b82',
    line: 'rgba(31, 30, 27, 0.08)',
    lineStrong: 'rgba(31, 30, 27, 0.16)',
    hover: 'rgba(31, 30, 27, 0.05)',
    sidebar: '#f3f1ea',
  },
  {
    id: 'sepia',
    label: '米黄',
    background: '#f3ead8',
    text: '#3b3329',
    soft: '#6b6051',
    muted: '#8f8270',
    line: 'rgba(59, 51, 41, 0.1)',
    lineStrong: 'rgba(59, 51, 41, 0.18)',
    hover: 'rgba(59, 51, 41, 0.07)',
    sidebar: '#ebe0ca',
  },
  {
    id: 'green',
    label: '护眼绿',
    background: '#e3eddc',
    text: '#26301f',
    soft: '#55634e',
    muted: '#7a8872',
    line: 'rgba(38, 48, 31, 0.1)',
    lineStrong: 'rgba(38, 48, 31, 0.18)',
    hover: 'rgba(38, 48, 31, 0.07)',
    sidebar: '#d7e3cf',
  },
  {
    id: 'night',
    label: '夜间',
    background: '#1f1e1b',
    text: '#d6d3cb',
    soft: '#9a968c',
    muted: '#7c7870',
    line: 'rgba(214, 211, 203, 0.1)',
    lineStrong: 'rgba(214, 211, 203, 0.2)',
    hover: 'rgba(214, 211, 203, 0.09)',
    sidebar: '#2a2925',
  },
]

export const TYPEFACES: { id: ReadingTypeface; label: string; family: string }[] = [
  { id: 'serif', label: '宋体', family: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', STSong, serif" },
  { id: 'sans', label: '黑体', family: "'HarmonyOS Sans SC', 'PingFang SC', 'MiSans', 'Microsoft YaHei UI', system-ui, sans-serif" },
]

/** 手机屏窄，边距比桌面版小 */
export const MARGINS: { id: ReadingMargin; label: string; px: number }[] = [
  { id: 'narrow', label: '窄', px: 12 },
  { id: 'medium', label: '中', px: 20 },
  { id: 'wide', label: '宽', px: 32 },
]

export function resolveReading(...layers: (ReadingSettings | undefined)[]): Required<ReadingSettings> {
  const out = { ...DEFAULT_READING }
  for (const l of layers) if (l) Object.assign(out, Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)))
  if (!READING_THEMES.some((t) => t.id === out.theme)) out.theme = 'paper'
  if (!TYPEFACES.some((t) => t.id === out.typeface)) out.typeface = 'serif'
  if (!MARGINS.some((m) => m.id === out.margin)) out.margin = 'medium'
  return out
}

export function themeSpec(id: ReadingTheme) {
  return READING_THEMES.find((t) => t.id === id) ?? READING_THEMES[0]
}

/** 把阅读主题写成 CSS 变量，套在顶栏、正文、底栏上；抽屉不受影响 */
export function themeVars(id: ReadingTheme): CSSProperties {
  const t = themeSpec(id)
  return {
    '--color-paper': t.background,
    '--color-ink': t.text,
    '--color-ink-soft': t.soft,
    '--color-muted': t.muted,
    '--color-line': t.line,
    '--color-line-strong': t.lineStrong,
    '--color-hover': t.hover,
    '--color-sidebar': t.sidebar,
    background: t.background,
    color: t.text,
    colorScheme: id === 'night' ? 'dark' : 'light',
  } as CSSProperties
}
