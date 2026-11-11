import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findBinary, findJsRuntime, resolveEngines } from '../shared/engines'
import { denoSpec, ffmpegKey, ytdlpSpec } from '../scripts/fetch-engines.mjs'

describe('findBinary', () => {
  it('uses a bundled file before PATH', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-bin-'))
    writeFileSync(path.join(dir, 'yt-dlp'), '#!/bin/sh\n')
    writeFileSync(path.join(dir, 'ffmpeg'), 'ffmpeg')
    writeFileSync(path.join(dir, 'ffprobe'), 'ffprobe')

    expect(findBinary(['yt-dlp'], [dir])).toBe(path.join(dir, 'yt-dlp'))

    const resolved = resolveEngines({
      binDirs: [dir],
      platform: 'linux',
      env: {},
      pathLookup: () => {
        throw new Error('PATH should not be consulted when bin/ has the file')
      },
    })
    expect(resolved.ytdlp).toMatchObject({ found: true, source: 'bundled' })
    expect(resolved.ffmpegLocation).toBe(dir)
    expect(resolved.flags).toEqual({ ytdlp: true, ffmpeg: true, ffprobe: true })
  })

  it('honors an environment override and falls back to PATH', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-env-'))
    const custom = path.join(dir, 'custom-yt-dlp')
    const ffmpeg = path.join(dir, 'ffmpeg')
    writeFileSync(custom, 'custom')
    writeFileSync(ffmpeg, 'ffmpeg')

    const overridden = resolveEngines({
      binDirs: [],
      platform: 'linux',
      env: { HARBOR_YTDLP: custom },
      pathLookup: (command) => (command === 'ffmpeg' || command === 'ffprobe' ? ffmpeg : null),
    })
    expect(overridden.ytdlp.path).toBe(custom)
    expect(overridden.ytdlp.source).toBe('env')
    expect(overridden.ffmpeg.source).toBe('path')
  })
})

describe('javascript runtime', () => {
  it('prefers a bundled Deno, then Node on PATH', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harbor-runtime-'))
    const deno = path.join(dir, 'deno')
    writeFileSync(deno, 'deno')
    const bundled = findJsRuntime({
      binDirs: [dir],
      platform: 'linux',
      pathLookup: () => {
        throw new Error('PATH should not be used when bin/deno exists')
      },
    })
    expect(bundled).toEqual({ runtime: 'deno', path: deno })

    const node = path.join(dir, 'node-bin')
    writeFileSync(node, 'node')
    const fromPath = findJsRuntime({
      binDirs: [path.join(dir, 'missing')],
      platform: 'linux',
      pathLookup: (command) => (command === 'node' ? node : null),
    })
    expect(fromPath).toEqual({ runtime: 'node', path: node })
  })
})

describe('fetch plan', () => {
  it('picks a yt-dlp and ffmpeg build for Mac, Windows, and Linux', () => {
    expect(ytdlpSpec('darwin', 'arm64')?.file).toBe('yt-dlp_macos')
    expect(ytdlpSpec('darwin', 'x64')?.file).toBe('yt-dlp_macos')
    expect(ytdlpSpec('win32', 'x64')?.file).toBe('yt-dlp.exe')
    expect(ytdlpSpec('linux', 'x64')?.file).toBe('yt-dlp')
    expect(ytdlpSpec('linux', 'arm64')?.file).toBe('yt-dlp_linux_aarch64')
    expect(ytdlpSpec('linux', 'ppc64')).toBeNull()
    expect(ffmpegKey('win32', 'x64')).toBe('win32-x64')
    expect(ffmpegKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(ffmpegKey('win32', 'arm64')).toBeNull()
    expect(denoSpec('linux', 'x64')?.file).toBe('deno')
    expect(denoSpec('darwin', 'arm64')?.url).toContain('aarch64-apple-darwin')
    expect(denoSpec('win32', 'x64')?.file).toBe('deno.exe')
    expect(denoSpec('win32', 'arm64')).toBeNull()
  })
})
