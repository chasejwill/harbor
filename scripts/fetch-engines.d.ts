export function ytdlpSpec(
  platform: string,
  arch: string,
): { url: string; file: string } | null

export function denoSpec(
  platform: string,
  arch: string,
): { url: string; file: string } | null

export function ffmpegKey(platform: string, arch: string): string | null

export function ffmpegSpecs(
  platform: string,
  arch: string,
): Array<{ url: string; file: string; gzip: boolean }> | null
