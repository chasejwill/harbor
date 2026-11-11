import type { AudioFormat, Mode, Stage } from './types'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
])

export type UrlCheck =
  | { ok: true; url: string; videoId: string }
  | { ok: false; message: string }

export function isMode(value: unknown): value is Mode {
  return value === 'video' || value === 'audio'
}

export function isAudioFormat(value: unknown): value is AudioFormat {
  return value === 'mp3' || value === 'wav'
}

export function validateYouTubeUrl(raw: string): UrlCheck {
  const trimmed = raw.trim().replace(/^<|>$/g, '').replace(/^["']|["']$/g, '')
  if (!trimmed) return { ok: false, message: 'Paste a YouTube link first.' }

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return { ok: false, message: 'That doesn’t look like a YouTube link. Use a youtube.com or youtu.be address.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'That doesn’t look like a YouTube link. Use a youtube.com or youtu.be address.' }
  }
  url.protocol = 'https:'

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const videoId = videoIdFrom(host, url)
  if (videoId) {
    return { ok: true, url: `${url.origin}${url.pathname}${url.search}`, videoId }
  }

  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean)
    const playlistOnly =
      parts[0] === 'playlist' || (url.searchParams.has('list') && !url.searchParams.get('v'))
    if (playlistOnly) {
      return { ok: false, message: 'Paste a link to one video. Harbor doesn’t save playlists.' }
    }
    if (parts[0] === 'watch') {
      return { ok: false, message: 'That link is missing a video id.' }
    }
    return { ok: false, message: 'Paste a link to a single video, not a channel or a playlist.' }
  }

  return { ok: false, message: 'That doesn’t look like a YouTube link. Use a youtube.com or youtu.be address.' }
}

function videoIdFrom(host: string, url: URL): string | null {
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return VIDEO_ID.test(id) ? id : null
  }
  if (!YOUTUBE_HOSTS.has(host)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'watch') {
    const id = url.searchParams.get('v') ?? ''
    return VIDEO_ID.test(id) ? id : null
  }
  if (parts[1] && ['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) {
    return VIDEO_ID.test(parts[1]) ? parts[1] : null
  }
  return null
}

export interface ArgRequest {
  url: string
  mode: Mode
  audioFormat: AudioFormat
  outputDir: string
}

export function buildArgs(
  request: ArgRequest,
  options: {
    ffmpegLocation?: string | null
    jsRuntime?: { runtime: 'deno' | 'node'; path: string } | null
  } = {},
): string[] {
  const output = joinOutput(request.outputDir, '%(title).180B [%(id)s].%(ext)s')
  const args = [
    '--no-playlist',
    '--no-colors',
    '--newline',
    '--progress',
    '--windows-filenames',
    '--retries',
    '5',
    '--fragment-retries',
    '5',
    '--socket-timeout',
    '30',
    '--output',
    output,
    '--print',
    'after_move:filepath:%(filepath)s',
    '--no-quiet',
    '--no-simulate',
  ]

  if (options.ffmpegLocation) {
    args.push('--ffmpeg-location', options.ffmpegLocation)
  }

  if (request.mode === 'video') {
    // Best video + best audio, remuxed into MP4 without re-encoding the picture.
    args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '--remux-video', 'mp4')
  } else {
    // Best audio stream, then ffmpeg encodes it to the format the user picked.
    args.push('-f', 'ba/b', '-x', '--audio-format', request.audioFormat)
    if (request.audioFormat === 'mp3') args.push('--audio-quality', '0')
  }

  args.push('--embed-metadata')
  if (options.jsRuntime) {
    args.push('--js-runtimes', `${options.jsRuntime.runtime}:${options.jsRuntime.path}`)
  }
  args.push(request.url)
  return args
}

function joinOutput(dir: string, template: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const sep = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed}${sep}${template}`
}

export type ParsedLine =
  | { kind: 'ignore' }
  | { kind: 'progress'; percent: number; speed: string | null; eta: string | null }
  | { kind: 'filepath'; filePath: string }
  | { kind: 'already'; filePath: string }
  | { kind: 'destination'; filePath: string }
  | { kind: 'stage'; stage: Stage; filePath?: string }

export function parseLine(raw: string): ParsedLine {
  const line = raw.trim()
  if (!line) return { kind: 'ignore' }

  if (line.startsWith('filepath:')) {
    const filePath = line.slice('filepath:'.length).trim()
    return filePath ? { kind: 'filepath', filePath } : { kind: 'ignore' }
  }

  const already = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded\s*$/)
  if (already?.[1]) return { kind: 'already', filePath: stripQuotes(already[1]) }

  const percent = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/)
  if (percent?.[1]) {
    return {
      kind: 'progress',
      percent: Number(percent[1]),
      speed: line.match(/\bat\s+(\S+)/)?.[1] ?? null,
      eta: line.match(/\bETA\s+(\S+)/)?.[1] ?? null,
    }
  }

  if (/^\[(?:Merger|VideoRemuxer)\]/.test(line)) {
    return { kind: 'stage', stage: 'merging', filePath: lastQuoted(line) ?? destinationPath(line) }
  }
  if (/^\[ExtractAudio\]/.test(line)) {
    return { kind: 'stage', stage: 'encoding', filePath: destinationPath(line) ?? lastQuoted(line) }
  }
  if (/^\[(?:Metadata|MoveFiles|Fixup|Embed)/.test(line)) {
    return { kind: 'stage', stage: 'finishing', filePath: lastQuoted(line) ?? destinationPath(line) }
  }

  const destination = line.match(/^\[download\]\s+Destination:\s+(.+)$/)
  if (destination?.[1]) return { kind: 'destination', filePath: stripQuotes(destination[1].trim()) }

  if (/^\[(?:youtube|info|generic)\]/i.test(line)) return { kind: 'stage', stage: 'preparing' }
  return { kind: 'ignore' }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function lastQuoted(line: string): string | undefined {
  const matches = [...line.matchAll(/"([^"]+)"/g)]
  return matches.at(-1)?.[1]
}

function destinationPath(line: string): string | undefined {
  const match = line.match(/Destination:\s+(.+)$/)
  return match?.[1] ? stripQuotes(match[1].trim()) : undefined
}

export function cleanSpeed(speed: string | null): string | null {
  if (!speed) return null
  const cleaned = speed.trim().replace(/^~/, '').trim()
  if (!cleaned || /unknown/i.test(cleaned)) return null
  return cleaned
}

export function formatEta(eta: string | null): string | null {
  if (!eta || /unknown|^na$/i.test(eta)) return null
  const parts = eta.split(':').map((part) => Number(part))
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => Number.isNaN(part))) return null
  const seconds =
    parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
  if (seconds <= 0) return null
  if (seconds < 60) return `About ${seconds}s left`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `About ${minutes}m ${rest}s left` : `About ${minutes}m left`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest ? `About ${hours}h ${minuteRest}m left` : `About ${hours}h left`
}

export function planSentence(mode: Mode, audioFormat: AudioFormat, tense: 'ready' | 'active'): string {
  if (mode === 'video') {
    return tense === 'active'
      ? 'Saving the highest-quality video and audio as an MP4.'
      : 'This saves the highest-quality video and audio as an MP4.'
  }
  const kind = audioFormat === 'wav' ? 'a WAV file' : 'an MP3 file'
  return tense === 'active'
    ? `Saving the highest-quality audio as ${kind}.`
    : `This saves the highest-quality audio as ${kind}.`
}

export function stageDetail(stage: Stage, audioFormat: AudioFormat): string {
  switch (stage) {
    case 'preparing':
      return 'Looking up the video…'
    case 'downloading':
      return 'Downloading the best stream…'
    case 'merging':
      return 'Merging video and audio into an MP4…'
    case 'encoding':
      return audioFormat === 'wav' ? 'Encoding the best audio to WAV…' : 'Encoding the best audio to MP3…'
    case 'finishing':
      return 'Writing the file…'
  }
}

export function fileBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

export function startupNotice(
  engines: { ytdlp: boolean; ffmpeg: boolean; ffprobe: boolean },
  hasRuntime: boolean,
): string | null {
  const missing = missingEnginesMessage(engines)
  if (hasRuntime) return missing
  const runtime =
    'Harbor couldn’t find Deno or Node. YouTube may hide some formats without one. Run npm run fetch-engines to download Deno.'
  return missing ? `${missing}\n\n${runtime}` : runtime
}

export function missingEnginesMessage(engines: { ytdlp: boolean; ffmpeg: boolean; ffprobe: boolean }): string | null {
  const missing: string[] = []
  if (!engines.ytdlp) missing.push('yt-dlp')
  if (!engines.ffmpeg) missing.push('ffmpeg')
  else if (!engines.ffprobe) missing.push('ffprobe')
  if (missing.length === 0) return null
  const need = missing.join(' and ')
  return `Harbor can’t find ${need}. Run npm run fetch-engines in the project folder, then restart. On a Mac you can instead run brew install yt-dlp ffmpeg. On Windows you can instead run winget install yt-dlp.yt-dlp and winget install Gyan.FFmpeg.`
}

export function humanError(output: string): string {
  const text = output.replace(/\u001b\[[0-9;]*m/g, '')
  const blob = text.toLowerCase()
  if (/private video/.test(blob)) {
    return 'This video is private. Harbor can only save videos you can open without signing in.'
  }
  if (/members only|channel.s members|join this channel to|this video is available to this channel/.test(blob)) {
    return 'This video is for channel members, so Harbor can’t save it.'
  }
  if (/video unavailable|has been removed|account associated with this video has been terminated|this video is not available/.test(blob)) {
    return 'This video is unavailable. It may have been removed or set to private.'
  }
  if (/sign in to confirm|not a bot|please log in|login required|age-restricted|age restricted|confirm your age/.test(blob)) {
    return 'YouTube is asking for a sign-in check, so Harbor can’t fetch this video.'
  }
  if (/unsupported url|is not a valid url/.test(blob)) {
    return 'That doesn’t look like a YouTube link Harbor can download.'
  }
  if (/requested format is not available|no video formats found|no such format/.test(blob)) {
    return 'This video doesn’t offer a stream Harbor can save in that format.'
  }
  if (/ffmpeg.*not found|ffprobe.*not found|ffmpeg or avconv/.test(blob)) {
    return 'Harbor needs ffmpeg to merge video and audio or to encode MP3 and WAV. Install ffmpeg and try again.'
  }
  if (/http error 403|403: forbidden/.test(blob)) {
    return 'YouTube refused the download. Run npm run fetch-engines -- --force to update yt-dlp, then try again.'
  }
  if (/permission denied|read-only file system|is not a directory|unable to open for writing|no space left/.test(blob)) {
    return 'Harbor couldn’t write to that folder. Choose a different save folder and try again.'
  }
  if (/network is unreachable|unable to download webpage|urlopen error|timed out|temporary failure in name resolution|certificate verify failed|getaddrinfo/.test(blob)) {
    return 'Harbor couldn’t reach YouTube. Check your connection and try again.'
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const errorLine = [...lines].reverse().find((line) => /^ERROR:/i.test(line))
  const cleaned = errorLine?.replace(/^ERROR:\s*/i, '').replace(/^\[[^\]]+\]\s*/, '')
  if (cleaned && cleaned.length < 220) return cleaned
  return 'The download failed before a file was saved.'
}

export interface NormalizedRequest {
  url: string
  mode: Mode
  audioFormat: AudioFormat
  outputDir: string
}

export function normalizeRequest(input: {
  url: unknown
  mode: unknown
  audioFormat: unknown
  outputDir: unknown
}): { ok: true; request: NormalizedRequest } | { ok: false; message: string } {
  if (!isMode(input.mode)) return { ok: false, message: 'Choose video and audio, or audio only.' }
  if (!isAudioFormat(input.audioFormat)) return { ok: false, message: 'Choose MP3 or WAV for audio.' }
  if (typeof input.outputDir !== 'string' || input.outputDir.trim() === '') {
    return { ok: false, message: 'Choose a folder to save into.' }
  }
  if (typeof input.url !== 'string') return { ok: false, message: 'Paste a YouTube link first.' }
  const checked = validateYouTubeUrl(input.url)
  if (!checked.ok) return checked
  return {
    ok: true,
    request: {
      url: checked.url,
      mode: input.mode,
      audioFormat: input.audioFormat,
      outputDir: input.outputDir.trim(),
    },
  }
}
