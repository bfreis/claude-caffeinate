// Settings and the command line they make. Plain functions, no `$`, so the tests can call them directly.

export type Mode = 'turn' | 'session' | 'off'
export type Program = 'caffeinate' | 'custom'

export type Settings = {
  mode: Mode
  program: Program
  flags: string
  custom: string
}

export const DEFAULTS: Settings = { mode: 'turn', program: 'caffeinate', flags: '-i', custom: '' }

export const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'turn', label: 'While Claude is working on a turn' },
  { value: 'session', label: 'For the whole session' },
  { value: 'off', label: 'Off' },
]

export const PROGRAMS: readonly { value: Program; label: string }[] = [
  { value: 'caffeinate', label: 'caffeinate (macOS)' },
  { value: 'custom', label: 'Custom command' },
]

export const FLAGS: readonly { value: string; label: string }[] = [
  { value: '-i', label: '-i    no idle sleep (display may still sleep)' },
  { value: '-di', label: '-di   no idle sleep, display stays on' },
  { value: '-s', label: '-s    no system sleep (on AC power only)' },
  { value: '-ims', label: '-ims  no idle, disk or system sleep' },
]

// Accepts whatever the store holds and keeps only valid fields, so an old or hand-edited value can't break the mod.
export function normalize(raw: unknown): Settings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T extends string>(x: unknown, allowed: readonly { value: T }[], d: T): T =>
    allowed.some((o) => o.value === x) ? (x as T) : d
  return {
    mode: pick(v.mode, MODES, DEFAULTS.mode),
    program: pick(v.program, PROGRAMS, DEFAULTS.program),
    flags: pick(v.flags, FLAGS, DEFAULTS.flags),
    custom: typeof v.custom === 'string' ? v.custom : DEFAULTS.custom,
  }
}

// Splits a command line the way a shell would for plain words, quotes and backslashes, without running a shell:
// no variables, globs, pipes or `&&`. Throws on an unclosed quote.
export function splitCommand(line: string): string[] {
  const out: string[] = []
  let word = ''
  let inWord = false
  let quote: '"' | "'" | undefined
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote === "'") {
      if (c === "'") quote = undefined
      else word += c
    } else if (quote === '"') {
      if (c === '"') quote = undefined
      else if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1]!)) word += line[++i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i]
      inWord = true
    } else if (c === ' ' || c === '\t' || c === '\n') {
      if (inWord) out.push(word)
      word = ''
      inWord = false
    } else {
      word += c
      inWord = true
    }
  }
  if (quote) throw new Error('unclosed ' + quote + ' quote')
  if (inWord) out.push(word)
  return out
}

// The command that keeps the machine awake, or a reason there is none.
export function commandFor(s: Settings): { argv: string[] } | { error: string } {
  if (s.program === 'caffeinate') return { argv: ['caffeinate', s.flags] }
  let argv: string[]
  try {
    argv = splitCommand(s.custom)
  } catch (err) {
    return { error: 'custom command: ' + (err instanceof Error ? err.message : String(err)) }
  }
  return argv.length ? { argv } : { error: 'no custom command set' }
}

export function shouldHold(s: Settings, isTurnRunning: boolean): boolean {
  return s.mode === 'session' || (s.mode === 'turn' && isTurnRunning)
}
