# Harbor

Harbor is a small desktop app for your own Mac or Windows PC. Paste one YouTube link, choose what to save, and press Start.

- **Video and audio** saves the highest-quality video stream and the highest-quality audio stream, merged into an MP4. The picture is remuxed, not re-encoded.
- **Audio only** takes that same highest-quality audio, then encodes it as **MP3** or **WAV**. You pick the format before you press Start. MP3 uses yt-dlp’s highest quality setting (`0`, the best VBR it offers). WAV is uncompressed PCM.

Harbor shows progress, explains a bad link or a private/unavailable video, and tells you where the file landed. The save folder starts as your Downloads folder. Choose another one if you want; Harbor remembers it on this computer.

This is a personal tool for one video at a time. It does not sign in to a YouTube account, and it does not download playlists. YouTube’s terms restrict downloading.

Harbor is not a website. `npm run dev` opens a window on your machine.

## Install and run

You need [Node.js](https://nodejs.org/) 20 or newer.

`npm install` downloads a current yt-dlp binary and [Deno](https://deno.com/) 2.9.8 into `bin/` for the computer you are on. yt-dlp needs Deno (or Node) to run YouTube’s player scripts; without one, some formats never appear. If `ffmpeg` and `ffprobe` are not already on your PATH, the same install downloads those into `bin/` as well. Harbor looks in `bin/` first, then on your PATH. Those downloaded programs are not committed to git.

If the download fails (offline, or a blocked GitHub), install the tools yourself and restart the app. The window says so when one of them is missing.

```bash
npm install
npm run dev
```

Update the downloaded tools later with:

```bash
npm run fetch-engines -- --force
```

To put a copy of ffmpeg in `bin/` even when one is already installed:

```bash
npm run fetch-engines -- --with-ffmpeg
```

Optional locations, if the programs live somewhere unusual:

- `HARBOR_YTDLP` — full path to the yt-dlp binary, or a folder that contains it
- `HARBOR_FFMPEG` — full path to the ffmpeg binary, or a folder that contains it

### macOS

```bash
# Optional. Skip this if npm install already filled bin/.
brew install yt-dlp ffmpeg

npm install
npm run dev
```

The first window is about 460 by 760 pixels, and it scrolls if you make it shorter. Paste with Command-V (the Edit menu is in the menu bar).

Build a `.dmg` **on a Mac**. A Linux machine cannot sign or package a Mac app, and this project does not try to cross-build one.

```bash
npm run dist:mac
```

That command downloads yt-dlp and ffmpeg for the Mac you are building on, then writes something like `release/Harbor-0.1.0-mac-arm64.dmg` (or `x64` on an Intel Mac). Open the dmg and drag Harbor to Applications. The engines in `bin/` are copied into the app, so the Mac you install it on does not need a separate yt-dlp or ffmpeg install.

Apple Silicon and Intel each need their own build, run on that kind of Mac. yt-dlp’s Mac binary is universal. The ffmpeg copy matches the Mac you build on.

### Windows

Use a 64-bit PC (the installer is x64). Windows on ARM is not covered by the fetched ffmpeg build; install ffmpeg yourself there if you are on an ARM PC and `npm run fetch-engines` says it has no build.

In PowerShell, from this folder:

```powershell
# Optional. Skip this if npm install already filled bin/.
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg

npm install
npm run dev
```

Paste with Ctrl-V. If the menu bar is hidden, Alt shows it.

Build the installer **on Windows**:

```powershell
npm run dist:win
```

The setup program is written to `release/`, named like `Harbor-0.1.0-win-x64.exe`. It is an NSIS installer, not a one-click install, so you can choose the folder. Same as on a Mac, the yt-dlp and ffmpeg downloaded on that PC are packed into the app.

### Linux

`npm run dev` is how this app is developed and tried. It is the same window as on Mac and Windows.

```bash
npm install
npm run dev
```

`npm run dist:linux` builds an AppImage. That is not a Mac or Windows installer.

## What the buttons do

1. Paste a `youtube.com` or `youtu.be` link to one video. Shorts, the music site, and embed links are fine. A channel or a playlist is refused.
2. Choose **Video and audio** or **Audio only**.
3. For audio only, choose **MP3** or **WAV** before Start. The sentence above Start states the file you will get.
4. Choose a folder, or leave Downloads.
5. Press **Start**. Press **Stop** if you want to cancel. A finished file is not written when you stop; a partial `.part` file may remain so a later download can resume.
6. When it finishes, Harbor shows the file name and the full path. **Show in folder** opens it.

The file name looks like `Title [videoId].mp4` (or `.mp3` / `.wav`).

## What “highest quality” means

Harbor does not upscale anything. It asks yt-dlp for the best video stream plus the best audio stream YouTube actually offers (`bv*+ba/b`), then ffmpeg merges them and remuxes the result to MP4 when those streams fit in an MP4. The video frames are not re-encoded. yt-dlp is given Deno from `bin/` when that file exists, otherwise Node from your PATH, so it can read the player scripts YouTube uses to list those streams.

Audio only asks for the best audio stream (`ba/b`) and then encodes that to the format you chose. If a video cannot be remuxed into MP4, Harbor shows the error instead of quietly re-encoding it to a smaller file.

## Tests

```bash
npm test
npm run typecheck
```

`npm test` does not contact YouTube. To try a real download of the short public clip yt-dlp uses in its own tests (`https://www.youtube.com/watch?v=BaW_jenozKc`):

```bash
HARBOR_SMOKE=1 npm test -- tests/smoke.test.ts
```

That checks an MP4 with video and audio, an MP3, and a 16-bit WAV.

## If something goes wrong

- **“That doesn’t look like a YouTube link.”** Use a link to one video, not a playlist or a channel.
- **Private, removed, members-only, or “sign in to confirm you’re not a bot.”** Harbor does not log in and does not read browser cookies. Those videos cannot be saved. A home network often works when a locked-down network does not.
- **YouTube refused the download (HTTP 403).** Run `npm run fetch-engines -- --force` and try again. YouTube changes this often.
- **ffmpeg or yt-dlp is missing.** Run `npm run fetch-engines`, or install them with Homebrew or winget, then restart Harbor.
- **MP3 fails with an encoder error.** The system ffmpeg was built without LAME. Run `npm run fetch-engines -- --with-ffmpeg` and restart. The ffmpeg copy Harbor downloads includes MP3 encoding. WAV needs PCM, which almost every ffmpeg has.

## Installers from another operating system

Build the Mac app on a Mac and the Windows app on Windows. Packaging copies the engines downloaded **for that computer**. A Linux ffmpeg binary packed on Linux will not run inside a Windows or Mac app, so do not copy `bin/` between operating systems before packaging.

This repository’s development machine is Linux. It can run Harbor in dev mode. It cannot produce a signed Mac disk image, and it does not claim to produce a Windows installer. `npm run dist:win` on Linux is not a supported path (electron-builder would need Wine and still would not be the build you should hand to a PC).

## Project layout

- `electron/` — the desktop process: folder picker, progress, and starting yt-dlp
- `src/` — the window
- `shared/` — link checks, yt-dlp arguments, progress parsing
- `scripts/fetch-engines.mjs` — downloads yt-dlp, Deno, and, when needed, ffmpeg
- `bin/` — those programs on your machine (gitignored, except `.gitkeep`)

## Licenses

Harbor’s own code is MIT. See [LICENSE](LICENSE).

yt-dlp is a separate program ([Unlicense](https://github.com/yt-dlp/yt-dlp)). Harbor starts it; it does not copy its source into this repo.

Deno is a separate program (MIT). Harbor downloads the official binary into `bin/` and passes it to yt-dlp. It is not part of Harbor’s source.

The optional ffmpeg binaries come from the [ffmpeg-static `b6.1.1` release](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1), which redistributes GPL builds of FFmpeg. Those files are downloaded into `bin/` and are not part of Harbor’s source. If you ship an installer that contains them, you are distributing FFmpeg under the GPL and need to pass along its license and source offer. The release includes `*.LICENSE` files. A system ffmpeg from Homebrew or winget stays under whatever license that package uses, and Harbor only invokes it.
