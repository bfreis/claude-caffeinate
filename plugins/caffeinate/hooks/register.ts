import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'
import { DEFAULTS, FLAGS, LID, MODES, NOTHING_PENDING, PROGRAMS, SCHEDULED, commandFor, holdReason, normalize } from './settings.js'
import type { Pending, Settings } from './settings.js'

const PANE = 'caffeinate'
const STORE_KEY = 'settings'
// Another session may change the settings; each session picks that up within this long
const REFRESH_MS = 15_000

// The lid helper (lid/): a root LaunchDaemon, installed once with an admin prompt, that keeps the Mac awake with the
// lid closed while a process holds it. 'busy' is an install or uninstall waiting on that prompt.
type LidState = 'unknown' | 'unsupported' | 'missing' | 'outdated' | 'installed' | 'busy'

// What the pane draws: the settings and what this session is doing about them
type View = {
  settings: Settings
  lid: LidState
  lidMessage: string | undefined
  holding: string | undefined
  reason: string | undefined
  problem: string | undefined
}
const view = atom(
  { plugin: 'caffeinate', key: 'view' } as const,
  { settings: DEFAULTS, lid: 'unknown', lidMessage: undefined, holding: undefined, reason: undefined, problem: undefined } as View,
)

// Module variables: a reload kills the child anyway, so these start over with it
let settings: Settings = DEFAULTS
let turnId: string | undefined
// What the last turn left running, from its Stop. An interrupted turn raises no Stop, so this stays as last reported
let pending: Pending = NOTHING_PENDING
let reason: string | undefined
let child: { key: string; label: string; stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult> } | undefined
let problem: string | undefined
let lid: LidState = 'unknown'
// The last lid helper error, shown in the pane
let lidMessage: string | undefined

async function loadSettings($: EngineInterface): Promise<void> {
  settings = normalize(await $.store.get(STORE_KEY))
}

async function saveSettings($: EngineInterface, change: Partial<Settings>): Promise<void> {
  // Re-read first: the store is shared by every session on the machine
  settings = normalize({ ...normalize(await $.store.get(STORE_KEY)), ...change })
  await $.store.set(STORE_KEY, settings)
  await sync($)
}

// Starts, swaps or stops the child so it matches the settings, whether a turn is running and what it left pending
async function sync($: EngineInterface): Promise<void> {
  reason = holdReason(settings, turnId !== undefined, pending)
  const want = reason ? commandFor(settings, $.plugin.root + '/lid/hold.sh') : undefined
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
  // Through the lid helper's hold script, name the command it runs rather than the script
  const shown = argv[0] === '/bin/sh' && argv[1] === $.plugin.root + '/lid/hold.sh' ? argv.slice(2) : argv
  const mine = { key: JSON.stringify(argv), label: shown.join(' ') + (shown === argv ? '' : ' (lid closed too)'), stream }
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
    problem = shown[0] + ' ' + ended + (said.trim() ? ': ' + said.trim().split('\n').pop() : '')
    await show($)
  })()
}

async function show($: EngineInterface): Promise<void> {
  // Never blocks the normal hold: a lid helper that is not ready only adds a note
  const lidNote = !settings.lid ? '' : lid === 'missing' ? ' (lid helper not installed: /caffeinate)' : lid === 'outdated' ? ' (lid helper needs an update: /caffeinate)' : ''
  if (problem) $.ui.status('☕ not keeping awake: ' + problem)
  else if (child) $.ui.status('☕ keeping awake: ' + reason + lidNote)
  else $.ui.status(undefined)
  const snapshot: View = { settings, lid, lidMessage, holding: child?.label, reason, problem }
  await update($, view, () => snapshot)
}

// Asks the helper's check script, which needs no privileges, whether the helper is installed and current
async function checkLid($: EngineInterface): Promise<void> {
  if (lid === 'busy') return
  try {
    const { exitCode } = await $.process.run(['/bin/sh', $.plugin.root + '/lid/check.sh'])
    lid = exitCode === 0 ? 'installed' : exitCode === 1 ? 'missing' : exitCode === 2 ? 'outdated' : 'unsupported'
  } catch {
    lid = 'unsupported'
  }
  await show($)
}

// Runs a lid script as root through the macOS admin prompt. Returns an error message, or undefined on success.
async function runAdmin($: EngineInterface, script: string, prompt: string): Promise<string | undefined> {
  try {
    const user = (await $.process.run(['id', '-un'])).stdout.trim()
    const r = await $.process.run(
      [
        '/usr/bin/osascript',
        '-e', 'on run argv',
        '-e', 'do shell script "/bin/sh " & quoted form of (item 1 of argv) & " " & quoted form of (item 2 of argv) with prompt "' + prompt + '" with administrator privileges',
        '-e', 'end run',
        $.plugin.root + '/lid/' + script,
        user,
      ],
      { timeoutMs: 600_000 },
    )
    if (r.exitCode === 0) return undefined
    if (r.stderr.includes('-128')) return 'cancelled'
    return r.stderr.trim().split('\n').pop() || 'exited with code ' + r.exitCode
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Installs or updates the helper. Only ever called for an explicit action in the pane: it raises the admin prompt.
async function installLid($: EngineInterface): Promise<boolean> {
  const before = lid
  lid = 'busy'
  lidMessage = undefined
  await show($)
  const failed = await runAdmin($, 'install.sh', 'caffeinate wants to install a helper that keeps your Mac awake with the lid closed.')
  lid = before
  if (failed) lidMessage = 'Could not install the lid helper: ' + failed
  await checkLid($)
  return !failed && lid === 'installed'
}

async function uninstallLid($: EngineInterface): Promise<void> {
  const before = lid
  lid = 'busy'
  lidMessage = undefined
  await show($)
  const failed = await runAdmin($, 'uninstall.sh', 'caffeinate wants to remove the helper that keeps your Mac awake with the lid closed.')
  lid = before
  if (failed) lidMessage = 'Could not uninstall the lid helper: ' + failed
  await checkLid($)
  if (!failed) await saveSettings($, { lid: false })
}

// Turning it on asks for admin only when the helper is missing or outdated. Turning it off touches nothing, so the
// idle helper stays and turning it on again never asks.
async function setLid($: EngineInterface, on: boolean): Promise<void> {
  if (!on) {
    lidMessage = undefined
    await saveSettings($, { lid: false })
    return
  }
  if (lid === 'busy') return
  if (lid === 'unknown') await checkLid($)
  lidMessage = undefined
  if (lid === 'unsupported') {
    lidMessage = 'Only on macOS'
    await show($)
    return
  }
  if ((lid === 'missing' || lid === 'outdated') && !(await installLid($))) return
  if (lid === 'installed') await saveSettings($, { lid: true })
}

// The install button shows when the helper is outdated, or wanted and not there
const needsInstall = (v: View): boolean => v.lid === 'outdated' || (v.settings.lid && v.lid === 'missing')

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadSettings($)
    // Only when asked for: the check is cheap, but a setting that is off should cost nothing
    if (settings.lid) await checkLid($)
    await sync($)
    $.clock.every(REFRESH_MS, async () => {
      const fresh = normalize(await $.store.get(STORE_KEY))
      // Also retries a child that died, e.g. a custom command that failed to start
      if (JSON.stringify(fresh) !== JSON.stringify(settings) || (!child && holdReason(fresh, turnId !== undefined, pending))) {
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

  // Fires at the end of a main-loop turn, just before turn.complete (not on an interrupt): what is left running or scheduled
  on('classic.Stop', async ($, e, next) => {
    pending = { background: e.background_tasks?.length ?? 0, scheduled: e.session_crons?.length ?? 0 }
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
    await checkLid($)
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
        ? Text({ color: 'success', children: ['Keeping awake (' + v.reason + '): ' + v.holding] })
        : Text({ dimColor: true, children: [s.mode === 'off' ? 'Off' : 'Idle: starts with the next turn'] })
    const wantsInstall = needsInstall(v)
    const save = (change: Partial<Settings>) => void saveSettings($, change)
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [
        state,
        Select({ key: 'mode', label: 'Keep awake', options: MODES, value: s.mode, onSelect: (value) => save({ mode: value as Settings['mode'] }) }),
        s.mode === 'turn'
          ? Text({ dimColor: true, children: ['Includes background work a turn leaves running (monitors, background shells and agents).'] })
          : undefined,
        s.mode === 'turn'
          ? Select({
              key: 'scheduled',
              label: 'Scheduled wake-ups (/loop, ScheduleWakeup, cron)',
              options: SCHEDULED,
              value: s.scheduled ? 'on' : 'off',
              onSelect: (value) => save({ scheduled: value === 'on' }),
            })
          : undefined,
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
        Select({ key: 'lid', label: 'Lid closed', options: LID, value: s.lid ? 'on' : 'off', onSelect: (value) => void setLid($, value === 'on') }),
        v.lidMessage ? Text({ color: 'warning', children: [v.lidMessage] }) : undefined,
        v.lid === 'busy' ? Text({ dimColor: true, children: ['Waiting for the lid helper: answer the admin prompt.'] }) : undefined,
        s.lid
          ? Text({ dimColor: true, children: ["The lid can close while awake is held. If it's ever stuck awake: sudo pmset -a disablesleep 0"] })
          : undefined,
        wantsInstall
          ? Button({ key: 'lid-install', label: 'Install/Update lid helper', onPress: () => void installLid($) })
          : undefined,
        v.lid === 'installed'
          ? Button({ key: 'lid-uninstall', label: 'Uninstall lid helper', onPress: () => void uninstallLid($) })
          : undefined,
        Text({ dimColor: true, children: ['Saved for every session on this machine. Esc closes.'] }),
        Button({ key: 'close', label: 'Close', role: 'dismiss', onPress: () => void $.ui.close({ id: PANE }) }),
      ],
    })
  })
}
