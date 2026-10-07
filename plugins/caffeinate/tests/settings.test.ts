import { expect, test } from 'claude-code/testing'
import { DEFAULTS, commandFor, normalize, shouldHold, splitCommand } from '../hooks/settings.js'

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
  expect(normalize({ mode: 'session', program: 'custom', flags: '-di', custom: 'x y' })).toEqual({
    mode: 'session', program: 'custom', flags: '-di', custom: 'x y',
  })
  expect(normalize({ mode: 'always', program: 'rm', flags: '-rf', custom: 3 })).toEqual(DEFAULTS)
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

test('shouldHold follows the mode', async () => {
  expect(shouldHold({ ...DEFAULTS, mode: 'turn' }, false)).toBe(false)
  expect(shouldHold({ ...DEFAULTS, mode: 'turn' }, true)).toBe(true)
  expect(shouldHold({ ...DEFAULTS, mode: 'session' }, false)).toBe(true)
  expect(shouldHold({ ...DEFAULTS, mode: 'off' }, true)).toBe(false)
})
