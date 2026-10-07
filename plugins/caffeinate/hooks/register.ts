import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { DEFAULTS, FLAGS, MODES, PROGRAMS, commandFor, normalize, shouldHold } from './settings.js'
import type { Settings } from './settings.js'

const PANE = 'caffeinate'
const STORE_KEY = 'settings'
// Another session may change the settings; each session picks that up within this long
const REFRESH_MS = 15_000

// What the pane draws: the settings and what this session is doing about them
type View = { settings: Settings; holding: string | undefined; problem: string | undefined }
const view = atom({ plugin: 'caffeinate', key: 'view' } as const, { settings: DEFAULTS, holding: undefined, problem: undefined } as View)

// Module variables: a reload kills the child anyway, so these start over with it
let settings: Settings = DEFAULTS
let turnId: string | undefined
let child: { key: string; label: string; stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult> } | undefined
let problem: string | undefined

async function loadSettings($: EngineInterface): Promise<void> {
  settings = normalize(await $.store.get(STORE_KEY))
}

async function saveSettings($: EngineInterface, change: Partial<Settings>): Promise<void> {
  // Re-read first: the store is shared by every session on the machine
  settings = normalize({ ...normalize(await $.store.get(STORE_KEY)), ...change })
  await $.store.set(STORE_KEY, settings)
  await sync($)
}

// Starts, swaps or stops the child so it matches the settings and whether a turn is running
async function sync($: EngineInterface): Promise<void> {
  const want = shouldHold(settings, turnId !== undefined) ? commandFor(settings) : undefined
  const key = want && 'argv' in want ? JSON.stringify(want.argv) : undefined
  if (child && child.key !== key) {
    const old = child
    child = undefined
    void old.stream.return({ code: null, signal: null })
  }
  if (want && 'error' in want) problem = want.error
  else if (!want) problem = undefined
  if (want && 'argv' in want && !child) start($, want.argv)
  await show($)
}

function start($: EngineInterface, argv: string[]): void {
  const stream = $.process.spawn({ argv })
  const mine = { key: JSON.stringify(argv), label: argv.join(' '), stream }
  child = mine
  problem = undefined
  void (async () => {
    let said = ''
    let ended = ''
    try {
      for (;;) {
        const r = await stream.next()
        if (r.done) {
          ended = r.value.signal ? 'was killed by ' + r.value.signal : 'exited with code ' + r.value.code
          break
        }
        if (r.value.stream === 'stderr') said = (said + r.value.text).slice(-200)
      }
    } catch (err) {
      ended = 'could not start: ' + (err instanceof Error ? err.message : String(err))
    }
    // Stopped on purpose (sync replaced it, or the module unloaded): nothing to report
    if (child !== mine) return
    child = undefined
    problem = argv[0] + ' ' + ended + (said.trim() ? ': ' + said.trim().split('\n').pop() : '')
    await show($)
  })()
}

async function show($: EngineInterface): Promise<void> {
  if (problem) $.ui.status('☕ not keeping awake: ' + problem)
  else if (child) $.ui.status('☕ keeping awake')
  else $.ui.status(undefined)
  const snapshot: View = { settings, holding: child?.label, problem }
  await update($, view, () => snapshot)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadSettings($)
    await sync($)
    $.clock.every(REFRESH_MS, async () => {
      const fresh = normalize(await $.store.get(STORE_KEY))
      // Also retries a child that died, e.g. a custom command that failed to start
      if (JSON.stringify(fresh) !== JSON.stringify(settings) || (!child && shouldHold(fresh, turnId !== undefined))) {
        settings = fresh
        await sync($)
      }
    })
    try {
      await $.command.register({ name: 'caffeinate', description: 'Keep the computer awake while Claude works: settings', immediate: true })
    } catch (err) {
      $.ui.log('caffeinate: could not register /caffeinate: ' + String(err))
    }
    return started
  })

  // Subagents raise no turn.start, and their turn.complete carries agentId: only the main loop's turn counts
  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    settings = normalize(await $.store.get(STORE_KEY))
    await sync($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.turnId === turnId) {
      turnId = undefined
      await sync($)
    }
    return next(e)
  })

  on('command.run', { command: 'caffeinate' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'caffeinate', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    // Select and Input exist only in the terminal and the desktop app
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Text, Select, Input, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const s = v.settings
    const state = v.problem
      ? Text({ color: 'warning', children: ['Not keeping awake: ' + v.problem] })
      : v.holding
        ? Text({ color: 'success', children: ['Keeping awake: ' + v.holding] })
        : Text({ dimColor: true, children: [s.mode === 'off' ? 'Off' : 'Idle: starts with the next turn'] })
    const save = (change: Partial<Settings>) => void saveSettings($, change)
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        state,
        Select({ key: 'mode', label: 'Keep awake', options: MODES, value: s.mode, onSelect: (value) => save({ mode: value as Settings['mode'] }) }),
        Select({ key: 'program', label: 'Using', options: PROGRAMS, value: s.program, onSelect: (value) => save({ program: value as Settings['program'] }) }),
        s.program === 'caffeinate'
          ? Select({ key: 'flags', label: 'Flags', options: FLAGS, value: s.flags, onSelect: (value) => save({ flags: value }) })
          : Input({
              key: 'custom',
              label: 'Command',
              placeholder: 'systemd-inhibit --what=idle sleep infinity',
              value: s.custom,
              submitLabel: 'Save',
              onSubmit: (value) => save({ custom: value.trim() }),
            }),
        s.program === 'custom'
          ? Text({ dimColor: true, children: ['Runs while awake is wanted and is stopped after. Quotes work; no shell (no pipes or &&).'] })
          : undefined,
        Text({ dimColor: true, children: ['Saved for every session on this machine. Esc closes.'] }),
        Button({ key: 'close', label: 'Close', role: 'dismiss', onPress: () => void $.ui.close({ id: PANE }) }),
      ],
    })
  })
}
