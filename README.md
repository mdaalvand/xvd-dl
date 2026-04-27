# xvd-dl

Minimal xvideos search and download tool.

## What it does

- Search videos by query
- Download search results
- Download direct video URLs
- Publish downloaded files to a GitHub release from a workflow

Default download quality is `480`.
It is passed to `yt-dlp` as a height cap, like `bestvideo[height<=480]+bestaudio/best[height<=480]/best`.
If you do not pass `--sort`, `--datef`, `--durf`, or `--search-quality`, the CLI leaves those filters out.
`--limit` is numeric and defaults to `100`, and the CLI paginates automatically until it collects that many results.
Download quality is selected by preset, not by typing raw numbers: `480p`, `720p`, `1080p`, or `best`.
If a search page cannot be loaded, the CLI keeps whatever results it already collected instead of aborting the whole run.

## Install

```bash
npm install
npm run build
```

## CLI

```bash
node dist/esm/cli.js search --query "gay latino"
node dist/esm/cli.js download --query "gay latino" --limit 100 --output downloads
node dist/esm/cli.js direct-download --url "https://www.xvideos.com/video..." --output downloads
```

If you prefer a binary-style entry point after publishing, the package exposes `xvd-dl`.

## GitHub Release workflow

Use `.github/workflows/release.yml` and run it manually.

- `mode=search` downloads the first matching search result or results
- `mode=direct-download` downloads the exact URL you pass
- `quality` defaults to `480`
- the output folder is uploaded as a release asset bundle
- release publishing is skipped automatically when the download step produces no files

## Library API

The upstream `xvideos` API is still available from the package entry point for programmatic use.
