import { describe, expect, it } from 'vitest'
import {
  buildArgs,
  formatEta,
  humanError,
  missingEnginesMessage,
  normalizeRequest,
  parseLine,
  planSentence,
  stageDetail,
  startupNotice,
  validateYouTubeUrl,
} from '../shared/plan'

const VIDEO = 'https://www.youtube.com/watch?v=BaW_jenozKc'

function rejection(raw: string): string {
  const result = validateYouTubeUrl(raw)
  if (result.ok) throw new Error(`expected a rejection for ${raw}`)
  return result.message
}

describe('validateYouTubeUrl', () => {
  it('accepts common single-video links', () => {
    const samples = [
      VIDEO,
      'https://youtu.be/BaW_jenozKc',
      'https://youtu.be/BaW_jenozKc?t=3',
      'https://www.youtube.com/shorts/BaW_jenozKc',
      'https://music.youtube.com/watch?v=BaW_jenozKc',
      'https://m.youtube.com/watch?v=BaW_jenozKc',
      'youtu.be/BaW_jenozKc',
      'https://www.youtube.com/embed/BaW_jenozKc',
      'https://www.youtube.com/live/BaW_jenozKc',
      'https://www.youtube.com/watch?v=BaW_jenozKc&list=PL0123456789',
      '  https://www.youtube.com/watch?v=BaW_jenozKc  ',
    ]
    for (const sample of samples) {
      const result = validateYouTubeUrl(sample)
      expect(result.ok, sample).toBe(true)
      if (result.ok) expect(result.videoId).toBe('BaW_jenozKc')
    }
  })

  it('rejects empty, other sites, playlists, and channels', () => {
    expect(rejection('')).toMatch(/Paste a YouTube link/)
    expect(rejection('   ')).toMatch(/Paste a YouTube link/)
    expect(rejection('https://vimeo.com/1')).toMatch(/youtube\.com or youtu\.be/)
    expect(rejection('https://www.youtube.com/playlist?list=PL123')).toMatch(/playlists/)
    expect(rejection('https://www.youtube.com/@somecreator')).toMatch(/single video/)
    expect(rejection('https://www.youtube.com/watch?v=short')).toMatch(/video id/)
    expect(rejection('javascript:alert(1)')).toMatch(/YouTube link/)
  })

  it('upgrades http links to https', () => {
    const result = validateYouTubeUrl('http://youtu.be/BaW_jenozKc')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url.startsWith('https://')).toBe(true)
  })
})

describe('buildArgs', () => {
  const dir = '/tmp/harbor-out'

  it('asks for the best video and audio and remuxes to mp4', () => {
    const args = buildArgs({ url: VIDEO, mode: 'video', audioFormat: 'mp3', outputDir: dir }, { ffmpegLocation: '/usr/bin' })
    expect(args).toContain('bv*+ba/b')
    expect(args).toContain('--merge-output-format')
    expect(args).toContain('--remux-video')
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4')
    expect(args[args.indexOf('--remux-video') + 1]).toBe('mp4')
    expect(args).not.toContain('-x')
    expect(args).not.toContain('--audio-format')
    expect(args).toContain('--ffmpeg-location')
    expect(args.at(-1)).toBe(VIDEO)
    expect(args).toContain('--no-playlist')
    expect(args).toContain('--no-simulate')
    const runtimeArgs = buildArgs(
      { url: VIDEO, mode: 'video', audioFormat: 'mp3', outputDir: dir },
      { jsRuntime: { runtime: 'deno', path: '/opt/deno' } },
    )
    expect(runtimeArgs[runtimeArgs.indexOf('--js-runtimes') + 1]).toBe('deno:/opt/deno')
    expect(runtimeArgs.at(-1)).toBe(VIDEO)
  })

  it('encodes the best audio to mp3 at the highest yt-dlp quality', () => {
    const args = buildArgs({ url: VIDEO, mode: 'audio', audioFormat: 'mp3', outputDir: dir })
    expect(args).toContain('ba/b')
    expect(args).toContain('-x')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
    expect(args[args.indexOf('--audio-quality') + 1]).toBe('0')
    expect(args).not.toContain('bv*+ba/b')
  })

  it('encodes the best audio to wav without an mp3 quality flag', () => {
    const args = buildArgs({ url: VIDEO, mode: 'audio', audioFormat: 'wav', outputDir: 'C:\\Users\\A\\Downloads' })
    expect(args[args.indexOf('--audio-format') + 1]).toBe('wav')
    expect(args).not.toContain('--audio-quality')
    const output = args[args.indexOf('--output') + 1]
    expect(output.startsWith('C:\\Users\\A\\Downloads\\')).toBe(true)
    expect(output.endsWith('%(title).180B [%(id)s].%(ext)s')).toBe(true)
  })
})

describe('progress and errors', () => {
  it('parses a download progress line', () => {
    const parsed = parseLine('[download]  42.5% of   10.00MiB at  1.50MiB/s ETA 00:08')
    expect(parsed).toMatchObject({ kind: 'progress', percent: 42.5, speed: '1.50MiB/s', eta: '00:08' })
  })

  it('parses the final path, merger, and audio encode destinations', () => {
    expect(parseLine('filepath:C:\\Users\\A\\Downloads\\Clip [id].mp4')).toMatchObject({
      kind: 'filepath',
      filePath: 'C:\\Users\\A\\Downloads\\Clip [id].mp4',
    })
    expect(parseLine('[Merger] Merging formats into "/tmp/Clip [id].mp4"')).toMatchObject({
      kind: 'stage',
      stage: 'merging',
      filePath: '/tmp/Clip [id].mp4',
    })
    expect(parseLine('[ExtractAudio] Destination: /tmp/Clip [id].wav')).toMatchObject({
      kind: 'stage',
      stage: 'encoding',
      filePath: '/tmp/Clip [id].wav',
    })
    expect(parseLine('[download] /tmp/Clip [id].mp3 has already been downloaded')).toMatchObject({
      kind: 'already',
      filePath: '/tmp/Clip [id].mp3',
    })
  })

  it('turns yt-dlp failures into short explanations', () => {
    expect(humanError('ERROR: [youtube] abc: Private video. Sign in if you have access')).toMatch(/private/i)
    expect(humanError('ERROR: [youtube] abc: Video unavailable')).toMatch(/unavailable/i)
    expect(humanError("ERROR: [youtube] abc: Sign in to confirm you’re not a bot")).toMatch(/sign-in/i)
    expect(humanError('ERROR: ffmpeg not found. Please install ffmpeg')).toMatch(/ffmpeg/i)
    expect(humanError('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toMatch(/refused/i)
    expect(humanError('ERROR: [youtube] abc: Join this channel to get access')).toMatch(/members/i)
  })

  it('formats the time remaining', () => {
    expect(formatEta('00:08')).toBe('About 8s left')
    expect(formatEta('01:02')).toBe('About 1m 2s left')
    expect(formatEta('Unknown')).toBeNull()
  })
})

describe('copy before start', () => {
  it('names the file the user will get', () => {
    expect(planSentence('video', 'mp3', 'ready')).toMatch(/MP4/)
    expect(planSentence('audio', 'mp3', 'ready')).toMatch(/MP3/)
    expect(planSentence('audio', 'wav', 'ready')).toMatch(/WAV/)
    expect(planSentence('audio', 'wav', 'active')).toMatch(/^Saving/)
    expect(stageDetail('encoding', 'wav')).toMatch(/WAV/)
    expect(stageDetail('merging', 'mp3')).toMatch(/MP4/)
  })

  it('explains a missing engine', () => {
    expect(missingEnginesMessage({ ytdlp: true, ffmpeg: true, ffprobe: true })).toBeNull()
    expect(missingEnginesMessage({ ytdlp: false, ffmpeg: false, ffprobe: false })).toMatch(/yt-dlp and ffmpeg/)
    expect(missingEnginesMessage({ ytdlp: true, ffmpeg: true, ffprobe: false })).toMatch(/ffprobe/)
    expect(startupNotice({ ytdlp: true, ffmpeg: true, ffprobe: true }, true)).toBeNull()
    expect(startupNotice({ ytdlp: true, ffmpeg: true, ffprobe: true }, false)).toMatch(/Deno or Node/)
  })

  it('rejects a start request that is not one video', () => {
    const bad = normalizeRequest({
      url: 'https://example.com/watch?v=BaW_jenozKc',
      mode: 'audio',
      audioFormat: 'wav',
      outputDir: '/tmp',
    })
    expect(bad.ok).toBe(false)
    const good = normalizeRequest({ url: VIDEO, mode: 'audio', audioFormat: 'wav', outputDir: '/tmp' })
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.request.audioFormat).toBe('wav')
  })
})
