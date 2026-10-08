import { expect, test } from 'claude-code/testing'
import { DEFAULTS, NOTHING_PENDING, commandFor, holdReason, normalize, splitCommand } from '../hooks/settings.js'

test('splitCommand splits words, quotes and backslashes without a shell', async () => {
  expect(splitCommand('caffeinate -i')).toEqual(['caffeinate', '-i'])
  expect(splitCommand('  a   b\tc  ')).toEqual(['a', 'b', 'c'])
  expect(splitCommand(`run 'two words' "and \\"more\\"" x\\ y ''`)).toEqual(['run', 'two words', 'and "more"', 'x y', ''])
  expect(splitCommand(`echo '$HOME' a&&b`)).toEqual(['echo', '$HOME', 'a&&b'])
  expect(splitCommand('')).toEqual([])
  expect(() => splitCommand(`say "unclosed`)).toThrow()
})

test('normalize keeps valid fields and drops the rest', async () => {
  expect(normalize(undefined)).toEqual(DEFAULTS)
  expect(normalize('junk')).toEqual(DEFAULTS)
  expect(normalize({ mode: 'session', scheduled: true, program: 'custom', flags: '-di', custom: 'x y', lid: true })).toEqual({
    mode: 'session', scheduled: true, program: 'custom', flags: '-di', custom: 'x y', lid: true,
  })
  expect(normalize({ mode: 'always', scheduled: 'yes', program: 'rm', flags: '-rf', custom: 3, lid: 'yes' })).toEqual(DEFAULTS)
  // Settings saved before `scheduled` existed keep working
  expect(normalize({ mode: 'turn', program: 'caffeinate', flags: '-s', custom: '' })).toEqual({ ...DEFAULTS, flags: '-s' })
})

test('commandFor builds caffeinate with its flags, or the custom command', async () => {
  expect(commandFor(DEFAULTS)).toEqual({ argv: ['caffeinate', '-i'] })
  expect(commandFor({ ...DEFAULTS, flags: '-s' })).toEqual({ argv: ['caffeinate', '-s'] })
  expect(commandFor({ ...DEFAULTS, program: 'custom', custom: 'ssh mac "caffeinate -i"' })).toEqual({
    argv: ['ssh', 'mac', 'caffeinate -i'],
  })
  expect(commandFor({ ...DEFAULTS, program: 'custom', custom: '   ' })).toEqual({ error: 'no custom command set' })
  expect(commandFor({ ...DEFAULTS, program: 'custom', custom: `x 'y` })).toEqual({ error: "custom command: unclosed ' quote" })
})

test('commandFor wraps the command with the hold script only when the lid setting is on', async () => {
  const hold = '/p/lid/hold.sh'
  expect(commandFor(DEFAULTS, hold)).toEqual({ argv: ['caffeinate', '-i'] })
  expect(commandFor({ ...DEFAULTS, lid: true })).toEqual({ argv: ['caffeinate', '-i'] })
  expect(commandFor({ ...DEFAULTS, lid: true }, hold)).toEqual({ argv: ['/bin/sh', hold, 'caffeinate', '-i'] })
  expect(commandFor({ ...DEFAULTS, lid: true, program: 'custom', custom: 'my-inhibit "a b"' }, hold)).toEqual({
    argv: ['/bin/sh', hold, 'my-inhibit', 'a b'],
  })
  expect(commandFor({ ...DEFAULTS, lid: true, program: 'custom', custom: '' }, hold)).toEqual({ error: 'no custom command set' })
})

test('holdReason follows the mode, the turn and what it left pending', async () => {
  const turn = { ...DEFAULTS, mode: 'turn' } as const
  const bg1 = { background: 1, scheduled: 0 }
  const cron = { background: 0, scheduled: 1 }
  expect(holdReason(turn, false, NOTHING_PENDING)).toBeUndefined()
  expect(holdReason(turn, true, NOTHING_PENDING)).toBe('Claude is working')
  expect(holdReason(turn, false, bg1)).toBe('1 background task running')
  expect(holdReason(turn, false, { background: 3, scheduled: 0 })).toBe('3 background tasks running')
  // On by default, so a session waiting on a /loop isn't cut off by sleep
  expect(holdReason(turn, false, cron)).toBe('a scheduled wake-up is pending')
  expect(holdReason({ ...turn, scheduled: false }, false, cron)).toBeUndefined()
  expect(holdReason({ ...turn, scheduled: true }, false, { background: 0, scheduled: 2 })).toBe('2 scheduled wake-ups are pending')
  expect(holdReason({ ...DEFAULTS, mode: 'session' }, false, NOTHING_PENDING)).toBe('for the session')
  expect(holdReason({ ...DEFAULTS, mode: 'off', scheduled: true }, true, { background: 1, scheduled: 1 })).toBeUndefined()
})
