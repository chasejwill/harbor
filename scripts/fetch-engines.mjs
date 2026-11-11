#!/usr/bin/env node
/**
 * Download yt-dlp for this computer into bin/.
 * Also download ffmpeg and ffprobe when they are not already on PATH,
 * or when --with-ffmpeg is passed (used before building an installer).
 *
 *   node scripts/fetch-engines.mjs
 *   node scripts/fetch-engines.mjs --with-ffmpeg
 *   node scripts/fetch-engines.mjs --force
 *   node scripts/fetch-engines.mjs --soft
 *   node scripts/fetch-engines.mjs --print-plan
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import zlib from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const binDir = path.join(root, 'bin')
const ffmpegRelease = 'b6.1.1'

export function ytdlpSpec(platform, arch) {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
  if (platform === 'win32') {
    if (arch === 'x64') return { url: `${base}yt-dlp.exe`, file: 'yt-dlp.exe' }
    if (arch === 'ia32') return { url: `${base}yt-dlp_x86.exe`, file: 'yt-dlp.exe' }
    return null
  }
  if (platform === 'darwin') return { url: `${base}yt-dlp_macos`, file: 'yt-dlp_macos' }
  if (platform === 'linux' && arch === 'x64') return { url: `${base}yt-dlp`, file: 'yt-dlp' }
  if (platform === 'linux' && arch === 'arm64') {
    return { url: `${base}yt-dlp_linux_aarch64`, file: 'yt-dlp_linux_aarch64' }
  }
  return null
}

export function ffmpegKey(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  return null
}

const denoVersion = 'v2.9.8'

export function denoSpec(platform, arch) {
  const base = `https://github.com/denoland/deno/releases/download/${denoVersion}/`
  const file = platform === 'win32' ? 'deno.exe' : 'deno'
  if (platform === 'linux' && arch === 'x64') return { url: `${base}deno-x86_64-unknown-linux-gnu.zip`, file }
  if (platform === 'linux' && arch === 'arm64') return { url: `${base}deno-aarch64-unknown-linux-gnu.zip`, file }
  if (platform === 'darwin' && arch === 'arm64') return { url: `${base}deno-aarch64-apple-darwin.zip`, file }
  if (platform === 'darwin' && arch === 'x64') return { url: `${base}deno-x86_64-apple-darwin.zip`, file }
  if (platform === 'win32' && arch === 'x64') return { url: `${base}deno-x86_64-pc-windows-msvc.zip`, file }
  return null
}

export function ffmpegSpecs(platform, arch) {
  const key = ffmpegKey(platform, arch)
  if (!key) return null
  const base = `https://github.com/eugeneware/ffmpeg-static/releases/download/${ffmpegRelease}/`
  const exe = platform === 'win32' ? '.exe' : ''
  return [
    { url: `${base}ffmpeg-${key}.gz`, file: `ffmpeg${exe}`, gzip: true },
    { url: `${base}ffprobe-${key}.gz`, file: `ffprobe${exe}`, gzip: true },
  ]
}

function onPath(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(finder, [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function fresh(file) {
  try {
    return statSync(file).size > 1_000_000
  } catch {
    return false
  }
}

async function download(url, dest, gunzip) {
  console.log(`Downloading ${url}`)
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'harbor-fetch-engines' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  const source = Readable.fromWeb(response.body)
  const target = gunzip ? zlib.createGunzip() : null
  const { createWriteStream } = await import('node:fs')
  const out = createWriteStream(dest)
  if (target) await pipeline(source, target, out)
  else await pipeline(source, out)
  try {
    chmodSync(dest, 0o755)
  } catch {
    // Windows has no executable bit.
  }
  const size = statSync(dest).size
  if (size < 1_000_000) {
    unlinkSync(dest)
    throw new Error(`Downloaded file is too small (${size} bytes): ${url}`)
  }
  console.log(`Saved ${dest}`)
}

async function installDeno(spec, dest) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'harbor-deno-'))
  const zip = path.join(tmp, 'deno.zip')
  try {
    await download(spec.url, zip, false)
    execFileSync('unzip', ['-o', '-j', zip, '-d', binDir], { stdio: 'inherit' })
    try {
      chmodSync(dest, 0o755)
    } catch {
      // Windows has no executable bit.
    }
    if (!fresh(dest)) throw new Error(`Deno archive did not contain ${spec.file}`)
    console.log(`Saved ${dest}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const soft = process.argv.includes('--soft')
  const force = process.argv.includes('--force')
  const withFfmpeg = process.argv.includes('--with-ffmpeg')
  const printPlan = process.argv.includes('--print-plan')
  const fail = (message) => {
    console.error(message)
    process.exit(soft ? 0 : 1)
  }

  const spec = ytdlpSpec(process.platform, process.arch)
  const ffmpeg = ffmpegSpecs(process.platform, process.arch)
  const deno = denoSpec(process.platform, process.arch)
  const needFfmpeg = withFfmpeg || !onPath('ffmpeg') || !onPath('ffprobe')
  if (printPlan) {
    console.log(JSON.stringify({ platform: process.platform, arch: process.arch, ytdlp: spec, deno, ffmpeg: needFfmpeg ? ffmpeg : null }, null, 2))
    return
  }
  if (!spec) {
    fail(`No yt-dlp build is prepared for ${process.platform} ${process.arch}. Install yt-dlp yourself and restart Harbor.`)
    return
  }

  try {
    mkdirSync(binDir, { recursive: true })
    const ytdlpPath = path.join(binDir, spec.file)
    if (!force && fresh(ytdlpPath)) console.log(`yt-dlp already present at ${ytdlpPath}`)
    else await download(spec.url, ytdlpPath, false)

    if (!deno) {
      console.log('No Deno build for this processor. Install Node or Deno if YouTube hides formats.')
    } else {
      const denoPath = path.join(binDir, deno.file)
      if (!force && fresh(denoPath)) console.log(`Deno already present at ${denoPath}`)
      else await installDeno(deno, denoPath)
    }

    if (!needFfmpeg) {
      console.log('ffmpeg and ffprobe are already on PATH. Skipping the ffmpeg download.')
      console.log('Run npm run fetch-engines -- --with-ffmpeg to put a copy in bin/ anyway.')
      return
    }
    if (!ffmpeg) {
      fail(`No ffmpeg build is prepared for ${process.platform} ${process.arch}. Install ffmpeg and ffprobe, then restart Harbor.`)
      return
    }
    for (const item of ffmpeg) {
      const dest = path.join(binDir, item.file)
      if (!force && fresh(dest)) console.log(`${item.file} already present at ${dest}`)
      else await download(item.url, dest, item.gzip)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    if (!soft) process.exit(1)
    console.error('Harbor will still install. Run npm run fetch-engines when you are online, or install yt-dlp and ffmpeg yourself.')
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main()
}
