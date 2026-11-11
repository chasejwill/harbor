import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDownload } from '../shared/download'
import { resolveEngines } from '../shared/engines'
import { buildArgs } from '../shared/plan'

const enabled = process.env.HARBOR_SMOKE === '1'
const videoUrl = 'https://www.youtube.com/watch?v=BaW_jenozKc'

describe.skipIf(!enabled)('yt-dlp smoke', () => {
  it(
    'saves a short public video as mp4 and as mp3 and wav',
    async () => {
      const root = path.resolve('bin')
      const engines = resolveEngines({ binDirs: [root] })
      expect(engines.ytdlp.path, 'yt-dlp is missing. Run npm run fetch-engines.').toBeTruthy()
      expect(engines.ffmpeg.path, 'ffmpeg is missing.').toBeTruthy()
      const out = mkdtempSync(path.join(tmpdir(), 'harbor-smoke-'))

      const mp4 = await save('video', 'mp3', out, engines.ytdlp.path!, engines.ffmpegLocation)
      expect(mp4.endsWith('.mp4')).toBe(true)
      expect(statSync(mp4).size).toBeGreaterThan(1000)
      const mp4Streams = streams(mp4, engines.ffprobe.path)
      expect(mp4Streams.some((stream) => stream.codec_type === 'video')).toBe(true)
      expect(mp4Streams.some((stream) => stream.codec_type === 'audio')).toBe(true)

      const mp3 = await save('audio', 'mp3', out, engines.ytdlp.path!, engines.ffmpegLocation)
      expect(mp3.endsWith('.mp3')).toBe(true)
      expect(streams(mp3, engines.ffprobe.path).some((stream) => stream.codec_name === 'mp3')).toBe(true)

      const wav = await save('audio', 'wav', out, engines.ytdlp.path!, engines.ffmpegLocation)
      expect(wav.endsWith('.wav')).toBe(true)
      const wavStreams = streams(wav, engines.ffprobe.path)
      expect(wavStreams.some((stream) => stream.codec_name === 'pcm_s16le')).toBe(true)
      expect(wavStreams.some((stream) => stream.codec_type === 'video')).toBe(false)
    },
    180_000,
  )
})

async function save(
  mode: 'video' | 'audio',
  audioFormat: 'mp3' | 'wav',
  outputDir: string,
  binary: string,
  ffmpegLocation: string | null,
) {
  const result = await runDownload({
    binary,
    args: buildArgs({ url: videoUrl, mode, audioFormat, outputDir }, { ffmpegLocation }),
    signal: new AbortController().signal,
    onProgress: () => {},
  })
  expect(existsSync(result.filePath)).toBe(true)
  return result.filePath
}

function streams(file: string, ffprobe: string | null): Array<{ codec_type?: string; codec_name?: string }> {
  const probe = ffprobe && existsSync(ffprobe) ? ffprobe : 'ffprobe'
  const raw = execFileSync(probe, ['-show_streams', '-of', 'json', file], { encoding: 'utf8' })
  const parsed = JSON.parse(raw) as { streams?: Array<{ codec_type?: string; codec_name?: string }> }
  return parsed.streams ?? []
}
