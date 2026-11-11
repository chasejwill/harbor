import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { directoryExists, readSettings, writeSettings } from '../shared/settings'

describe('settings', () => {
  it('remembers a save folder and ignores a broken file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-settings-'))
    const file = path.join(dir, 'settings.json')
    expect(readSettings(file)).toEqual({})
    writeSettings(file, { outputDir: dir })
    expect(readSettings(file).outputDir).toBe(dir)
    expect(directoryExists(dir)).toBe(true)
    expect(directoryExists(path.join(dir, 'missing'))).toBe(false)
    writeSettings(file, {})
    expect(readSettings(path.join(dir, 'nope.json'))).toEqual({})
  })
})
