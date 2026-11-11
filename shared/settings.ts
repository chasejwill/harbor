import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface Settings {
  outputDir?: string
}

export function directoryExists(dir: string | undefined): dir is string {
  if (!dir) return false
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

export function readSettings(file: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Settings
    if (parsed && typeof parsed.outputDir === 'string') {
      return { outputDir: parsed.outputDir }
    }
  } catch {
    // Missing or unreadable settings are treated as first launch.
  }
  return {}
}

export function writeSettings(file: string, settings: Settings): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(settings, null, 2))
}
