import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { EngineFlags } from './types'

export interface ResolvedBinary {
  path: string | null
  found: boolean
  source: 'env' | 'bundled' | 'path' | null
}

export interface ResolvedEngines {
  ytdlp: ResolvedBinary
  ffmpeg: ResolvedBinary
  ffprobe: ResolvedBinary
  ffmpegLocation: string | null
  flags: EngineFlags
}

export function binaryNames(kind: 'ytdlp' | 'ffmpeg' | 'ffprobe', platform = process.platform): string[] {
  if (kind === 'ytdlp') {
    if (platform === 'win32') return ['yt-dlp.exe']
    if (platform === 'darwin') return ['yt-dlp_macos', 'yt-dlp']
    return ['yt-dlp', 'yt-dlp_linux', 'yt-dlp_linux_aarch64']
  }
  const exe = platform === 'win32' ? '.exe' : ''
  return [kind + exe]
}

export function findBinary(names: string[], dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of names) {
      const full = usableFile(path.join(dir, name))
      if (full) return full
    }
  }
  return null
}

export function findOnPath(command: string, platform = process.platform): string | null {
  const finder = platform === 'win32' ? 'where' : 'which'
  try {
    const output = execFileSync(finder, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = output
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean)
    return usableFile(line ?? null)
  } catch {
    return null
  }
}

export function findJsRuntime(options: {
  binDirs: string[]
  platform?: NodeJS.Platform
  pathLookup?: (command: string) => string | null
}): { runtime: 'deno' | 'node'; path: string } | null {
  const platform = options.platform ?? process.platform
  const pathLookup = options.pathLookup ?? ((command: string) => findOnPath(command, platform))
  const denoName = platform === 'win32' ? 'deno.exe' : 'deno'
  const nodeName = platform === 'win32' ? 'node.exe' : 'node'
  const deno = findBinary([denoName], options.binDirs) ?? lookupFile(denoName, pathLookup)
  if (deno) return { runtime: 'deno', path: deno }
  const node = findBinary([nodeName], options.binDirs) ?? lookupFile(nodeName, pathLookup)
  if (node) return { runtime: 'node', path: node }
  return null
}

function lookupFile(name: string, pathLookup: (command: string) => string | null): string | null {
  const found = pathLookup(name)
  if (!found) return null
  try {
    return existsSync(found) && statSync(found).isFile() ? found : null
  } catch {
    return null
  }
}

export function resolveEngines(options: {
  binDirs: string[]
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  pathLookup?: (command: string) => string | null
}): ResolvedEngines {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const pathLookup = options.pathLookup ?? ((command: string) => findOnPath(command, platform))

  const ytdlp = resolveOne(binaryNames('ytdlp', platform), options.binDirs, env.HARBOR_YTDLP, pathLookup)
  const ffmpeg = resolveOne(binaryNames('ffmpeg', platform), options.binDirs, env.HARBOR_FFMPEG, pathLookup)
  const ffprobeNames = binaryNames('ffprobe', platform)
  const besideFfmpeg = ffmpeg.path ? findBinary(ffprobeNames, [path.dirname(ffmpeg.path)]) : null
  const ffprobeFile = besideFfmpeg ?? usableFile(pathLookup(ffprobeNames[0] ?? 'ffprobe'))
  const ffprobe: ResolvedBinary = ffprobeFile
    ? { path: ffprobeFile, found: true, source: besideFfmpeg ? ffmpeg.source : 'path' }
    : { path: null, found: false, source: null }

  const ffmpegLocation =
    ffmpeg.path && ffprobe.path && path.dirname(ffmpeg.path) === path.dirname(ffprobe.path)
      ? path.dirname(ffmpeg.path)
      : null

  return {
    ytdlp,
    ffmpeg,
    ffprobe,
    ffmpegLocation,
    flags: {
      ytdlp: ytdlp.found,
      ffmpeg: ffmpeg.found,
      ffprobe: ffprobe.found,
    },
  }
}

function resolveOne(
  names: string[],
  dirs: string[],
  override: string | undefined,
  pathLookup: (command: string) => string | null,
): ResolvedBinary {
  const fromEnv = override ? fromOverride(override, names) : null
  if (fromEnv) return { path: fromEnv, found: true, source: 'env' }

  const bundled = findBinary(names, dirs)
  if (bundled) return { path: bundled, found: true, source: 'bundled' }

  for (const name of names) {
    const found = pathLookup(name)
    const file = usableFile(found)
    if (file) return { path: file, found: true, source: 'path' }
  }
  return { path: null, found: false, source: null }
}

function fromOverride(value: string, names: string[]): string | null {
  const direct = usableFile(value)
  if (direct) return direct
  return findBinary(names, [value])
}

function usableFile(file: string | null | undefined): string | null {
  if (!file) return null
  try {
    return existsSync(file) && statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}
