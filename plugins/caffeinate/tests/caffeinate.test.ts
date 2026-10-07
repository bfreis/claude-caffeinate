import { expect, mock, test } from 'claude-code/testing'

// The test runner has timers; the mods typings (no Node, no DOM) don't declare them
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown

// command.run's input type requires origin and presentation; the engine stamps them in a session
const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const PANE = {
  plugin: 'caffeinate', component: 'Pane', requestId: 'caffeinate', viewport: { columns: 100, rows: 30 },
  props: { title: 'caffeinate', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// A fake child per spawn: it runs until the test ends it or the mod stops reading it
type Child = { argv: readonly string[]; isRunning: boolean; exit: (code: number, text?: string) => void }

function harness(on: any, saved: Record<string, unknown> = {}, heartbeat = true) {
  const children: Child[] = []
  const statuses: (string | undefined)[] = []
  const store = new Map<string, unknown>(Object.entries(saved))
  const clock = mock.clock(on, { now: 0 })
  on('store.get', ($: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', ($: unknown, e: { text: string | undefined }) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  // It wakes every few ms with a heartbeat, so a stop from the mod (return() on its stream) reaches the finally
  on('process.spawn', async function* ($: unknown, e: { argv: readonly string[] }) {
    let end: { code: number; text: string } | undefined
    const child: Child = { argv: e.argv, isRunning: true, exit: (code, text = '') => (end = { code, text }) }
    children.push(child)
    try {
      while (!end) {
        if (heartbeat) yield { stream: 'stdout', text: '.' }
        await new Promise((r) => setTimeout(r, heartbeat ? 1 : 5))
      }
      if (end.text) yield { stream: 'stderr', text: end.text }
      return { value: { code: end.code, signal: null } }
    } finally {
      child.isRunning = false
    }
  })
  const running = () => children.filter((c) => c.isRunning).map((c) => c.argv.join(' '))
  const status = () => statuses[statuses.length - 1]
  return { children, running, status, store, clock }
}

// What Claude Code reports at the end of a main-loop turn (it raises Stop just before turn.complete)
const endTurn = async ($: any, turnId: string, left: { background?: number; crons?: number } = {}) => {
  await $.classic.Stop({
    session_id: 's', transcript_path: '/t', cwd: '/work', hook_event_name: 'Stop', stop_hook_active: false,
    background_tasks: Array.from({ length: left.background ?? 0 }, (_, i) => ({ id: 'b' + i, type: 'shell', status: 'running', description: 'watch' })),
    session_crons: Array.from({ length: left.crons ?? 0 }, (_, i) => ({ id: 'c' + i, schedule: '0 9 * * *', recurring: false, prompt: 'hi' })),
  })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await settle()
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const settle = () => new Promise((r) => setTimeout(r, 20))

test('by default it keeps awake only while a turn runs', async ($, on) => {
  const h = harness(on)
  await start($)
  expect(h.running()).toEqual([])
  expect(h.status()).toBeUndefined()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(h.running()).toEqual(['caffeinate -i'])
  expect(h.status()).toBe('☕ keeping awake: Claude is working')

  // A subagent's turn ending is not the main turn ending
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  await settle()
  expect(h.running()).toEqual(['caffeinate -i'])

  await endTurn($, 't1')
  expect(h.running()).toEqual([])
  expect(h.status()).toBeUndefined()
})

test('background work a turn leaves running keeps it awake until a turn ends with none', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.turn.start({ text: 'watch the build', turnId: 't1' })
  await endTurn($, 't1', { background: 1 })
  expect(h.running()).toEqual(['caffeinate -i'])
  expect(h.status()).toBe('☕ keeping awake: 1 background task running')

  // The monitor's notification starts a turn; it ends with nothing left running
  await $.turn.start({ text: '', turnId: 't2' })
  expect(h.children.length).toBe(1)
  await endTurn($, 't2')
  expect(h.running()).toEqual([])
  expect(h.status()).toBeUndefined()
})

test('an interrupted turn (no Stop) keeps what the last Stop reported', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.turn.start({ text: 'watch', turnId: 't1' })
  await endTurn($, 't1', { background: 1 })
  await $.turn.start({ text: 'more', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' })
  await settle()
  expect(h.running()).toEqual(['caffeinate -i'])
})

test('scheduled wake-ups keep it awake by default, and not once that setting is off', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.turn.start({ text: 'loop', turnId: 't1' })
  await endTurn($, 't1', { crons: 1 })
  expect(h.running()).toEqual(['caffeinate -i'])
  expect(h.status()).toBe('☕ keeping awake: a scheduled wake-up is pending')

  // The wake-up fired and nothing else is scheduled
  await $.turn.start({ text: 'hi', turnId: 't2' })
  await endTurn($, 't2')
  expect(h.running()).toEqual([])

  h.store.set('settings', { mode: 'turn', scheduled: false, program: 'caffeinate', flags: '-i', custom: '' })
  await $.turn.start({ text: 'loop', turnId: 't3' })
  await endTurn($, 't3', { crons: 1 })
  expect(h.running()).toEqual([])
})

test('an interrupted turn releases too', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  await settle()
  expect(h.running()).toEqual([])
})

test('session mode holds from the start, and off never holds', async ($, on) => {
  const h = harness(on, { settings: { mode: 'session', program: 'caffeinate', flags: '-di', custom: '' } })
  await start($)
  expect(h.running()).toEqual(['caffeinate -di'])
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await endTurn($, 't1')
  expect(h.running()).toEqual(['caffeinate -di'])
})

test('off never holds', async ($, on) => {
  const h = harness(on, { settings: { mode: 'off', program: 'caffeinate', flags: '-i', custom: '' } })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(h.children.length).toBe(0)
})

test('a custom command runs as its words, no shell', async ($, on) => {
  const h = harness(on, { settings: { mode: 'turn', program: 'custom', flags: '-i', custom: `ssh mac 'caffeinate -i'` } })
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(h.children.map((c) => c.argv)).toEqual([['ssh', 'mac', 'caffeinate -i']])
})

test('a child that exits on its own is reported, not silently lost', async ($, on) => {
  // A quiet child: clock.advance, like ui.find, waits for spawn streams to go quiet
  const h = harness(on, { settings: { mode: 'turn', program: 'custom', flags: '-i', custom: 'nope' } }, false)
  await start($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  h.children[0]!.exit(127, 'nope: command not found\n')
  await settle()
  expect(h.status()).toBe('☕ not keeping awake: nope exited with code 127: nope: command not found')

  // Tried again on the next refresh, while the turn still wants it
  await h.clock.advance(15_000)
  await settle()
  expect(h.children.map((c) => c.argv.join(' '))).toEqual(['nope', 'nope'])
  expect(h.status()).toBe('☕ keeping awake: Claude is working')
})

// ui.find waits for spawn streams to go quiet, so these children never write and this test reads what was started
test('the pane changes settings, saves them, and applies them at once', async ($, on) => {
  const h = harness(on, {}, false)
  const started = () => h.children.map((c) => c.argv.join(' '))
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Idle: starts with the next turn' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'scheduled', value: 'off' })
  await settle()
  expect(h.store.get('settings')).toEqual({ mode: 'turn', scheduled: false, program: 'caffeinate', flags: '-i', custom: '' })
  await ui.select({ key: 'scheduled', value: 'on' })
  await settle()
  await ui.select({ key: 'mode', value: 'session' })
  await settle()
  expect(h.store.get('settings')).toEqual({ mode: 'session', scheduled: true, program: 'caffeinate', flags: '-i', custom: '' })
  // The scheduled wake-ups control applies to turn mode only
  expect(await ui.find({ type: 'Select', key: 'scheduled' })).toBeUndefined()
  expect(started()).toEqual(['caffeinate -i'])
  expect(await ui.find({ type: 'Text', text: 'Keeping awake (for the session): caffeinate -i' })).toBeDefined()

  await ui.select({ key: 'flags', value: '-s' })
  await settle()
  expect(started()).toEqual(['caffeinate -i', 'caffeinate -s'])
  expect(await ui.find({ type: 'Text', text: 'Keeping awake (for the session): caffeinate -s' })).toBeDefined()

  await ui.select({ key: 'program', value: 'custom' })
  await settle()
  expect(started().length).toBe(2)
  expect(await ui.find({ type: 'Text', text: 'Not keeping awake: no custom command set' })).toBeDefined()

  await ui.input({ key: 'custom', text: '  my-inhibit --forever ' })
  await settle()
  expect(started()[2]).toBe('my-inhibit --forever')
  expect(h.store.get('settings')).toEqual({ mode: 'session', scheduled: true, program: 'custom', flags: '-s', custom: 'my-inhibit --forever' })
  await ui.unmount()
})

test('/caffeinate opens the pane without printing anything', async ($, on) => {
  harness(on)
  await start($)
  const answer = await $.command.run({ command: 'caffeinate', args: '', ...typed })
  expect(answer).toEqual({})
})
