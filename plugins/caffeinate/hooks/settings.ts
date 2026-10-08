// Settings and the command line they make. Plain functions, no `$`, so the tests can call them directly.

export type Mode = 'turn' | 'session' | 'off'
export type Program = 'caffeinate' | 'custom'

export type Settings = {
  mode: Mode
  // Turn mode: also stay awake while a scheduled wake-up (CronCreate, ScheduleWakeup, /loop) is pending
  scheduled: boolean
  program: Program
  flags: string
  custom: string
  // macOS: also keep the Mac awake with the lid closed, through the lid helper (see lid/)
  lid: boolean
}

export const DEFAULTS: Settings = { mode: 'turn', scheduled: true, program: 'caffeinate', flags: '-i', custom: '', lid: false }

// What the session still has going after a turn ends, as the last Stop reported it
export type Pending = { background: number; scheduled: number }

export const NOTHING_PENDING: Pending = { background: 0, scheduled: 0 }

export const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'turn', label: 'While Claude is working on a turn' },
  { value: 'session', label: 'For the whole session' },
  { value: 'off', label: 'Off' },
]

export const SCHEDULED: readonly { value: 'off' | 'on'; label: string }[] = [
  { value: 'on', label: 'Stay awake for them' },
  { value: 'off', label: 'Let it sleep until then' },
]

export const LID: readonly { value: 'off' | 'on'; label: string }[] = [
  { value: 'off', label: 'Sleep as usual' },
  { value: 'on', label: 'Stay awake with the lid closed (macOS; one-time admin install)' },
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
    scheduled: typeof v.scheduled === 'boolean' ? v.scheduled : DEFAULTS.scheduled,
    program: pick(v.program, PROGRAMS, DEFAULTS.program),
    flags: pick(v.flags, FLAGS, DEFAULTS.flags),
    custom: typeof v.custom === 'string' ? v.custom : DEFAULTS.custom,
    lid: typeof v.lid === 'boolean' ? v.lid : DEFAULTS.lid,
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

// The command that keeps the machine awake, or a reason there is none. With the lid setting on and a hold script,
// the command runs through it (it registers the process with the lid helper, then execs the command).
export function commandFor(s: Settings, holdScript?: string): { argv: string[] } | { error: string } {
  const wrap = (argv: string[]) => ({ argv: s.lid && holdScript ? ['/bin/sh', holdScript, ...argv] : argv })
  if (s.program === 'caffeinate') return wrap(['caffeinate', s.flags])
  let argv: string[]
  try {
    argv = splitCommand(s.custom)
  } catch (err) {
    return { error: 'custom command: ' + (err instanceof Error ? err.message : String(err)) }
  }
  return argv.length ? wrap(argv) : { error: 'no custom command set' }
}

// Why the machine should stay awake right now, or undefined when it may sleep
export function holdReason(s: Settings, isTurnRunning: boolean, pending: Pending): string | undefined {
  if (s.mode === 'session') return 'for the session'
  if (s.mode === 'off') return undefined
  if (isTurnRunning) return 'Claude is working'
  if (pending.background > 0) return pending.background === 1 ? '1 background task running' : pending.background + ' background tasks running'
  if (s.scheduled && pending.scheduled > 0) return pending.scheduled === 1 ? 'a scheduled wake-up is pending' : pending.scheduled + ' scheduled wake-ups are pending'
  return undefined
}
