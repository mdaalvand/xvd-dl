#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import xvideos from './index.js';
import { DEFAULT_DOWNLOAD_QUALITY, downloadVideo } from './downloader.js';
import type { VideoDetailsResult, VideoSummary } from './types/index.js';

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
};

type OutputFormat = 'text' | 'json';

const parseArgv = (argv: string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const [namePart, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      const values = flags.get(namePart) ?? [];
      values.push(inlineValue);
      flags.set(namePart, values);
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      const values = flags.get(namePart) ?? [];
      values.push(next);
      flags.set(namePart, values);
      index += 1;
      continue;
    }

    booleans.add(namePart);
  }

  const command = positionals.shift() ?? 'help';
  return {
    command,
    positionals,
    flags,
    booleans,
  };
};

const getString = (
  parsed: ParsedArgs,
  name: string,
  fallback = '',
): string => {
  return parsed.flags.get(name)?.at(-1) ?? fallback;
};

const getNumber = (
  parsed: ParsedArgs,
  name: string,
  fallback: number,
): number => {
  const raw = getString(parsed, name, '');
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const getMany = (parsed: ParsedArgs, name: string): string[] => {
  return parsed.flags.get(name) ?? [];
};

const writeLine = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
  process.exit(2);
};

const resolveQuery = (parsed: ParsedArgs): string => {
  return getString(parsed, 'query') || parsed.positionals.join(' ').trim();
};

const outputSearchResults = (
  videos: VideoSummary[],
  format: OutputFormat,
): void => {
  if (format === 'json') {
    writeJson(videos);
    return;
  }

  for (const [index, video] of videos.entries()) {
    writeLine(`${index + 1}. ${video.title} | ${video.url}`);
  }
};

const loadSearchResults = async (
  query: string,
  page: number,
  limit: number,
): Promise<VideoSummary[]> => {
  const list = await xvideos.videos.search({ k: query, page });
  return list.videos.slice(0, limit);
};

const downloadSearchResults = async (
  query: string,
  page: number,
  limit: number,
  outputDir: string,
  quality: number,
): Promise<
  Array<
    | {
        ok: true;
        details: VideoDetailsResult;
        outputPath: string;
        sourceUrl: string;
      }
    | {
        ok: false;
        error: string;
        url: string;
      }
  >
> => {
  const results = await loadSearchResults(query, page, limit);
  const detailsBatch = await xvideos.videos.detailsMany(
    results.map((video) => ({ url: video.url })),
    {
      concurrency: 2,
      retries: 1,
      retryDelayMs: 500,
      minDelayMs: 0,
    },
  );

  const outputs: Array<
    | {
        ok: true;
        details: VideoDetailsResult;
        outputPath: string;
        sourceUrl: string;
      }
    | {
        ok: false;
        error: string;
        url: string;
      }
  > = [];

  for (const [index, item] of detailsBatch.items.entries()) {
    if (!item.ok) {
      outputs.push({
        ok: false,
        error: item.error.message,
        url: item.input.url,
      });
      continue;
    }

    try {
      const downloaded = await downloadVideo({
        details: item.value,
        outputDir,
        quality,
        index: index + 1,
      });
      outputs.push({
        ok: true,
        details: downloaded.details,
        outputPath: downloaded.outputPath,
        sourceUrl: downloaded.sourceUrl,
      });
    } catch (error) {
      outputs.push({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        url: item.value.url,
      });
    }
  }

  return outputs;
};

const runSearchCommand = async (parsed: ParsedArgs): Promise<void> => {
  const query = resolveQuery(parsed);
  if (!query) {
    fail('query is required');
  }

  const page = getNumber(parsed, 'page', 1);
  const limit = getNumber(parsed, 'limit', 10);
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';

  const videos = await loadSearchResults(query, page, limit);
  outputSearchResults(videos, format);
};

const runDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const query = resolveQuery(parsed);
  if (!query) {
    fail('query is required');
  }

  const page = getNumber(parsed, 'page', 1);
  const limit = getNumber(parsed, 'limit', 1);
  const quality = getNumber(parsed, 'quality', DEFAULT_DOWNLOAD_QUALITY);
  const outputDir = getString(parsed, 'output', 'downloads');
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';

  const results = await downloadSearchResults(
    query,
    page,
    limit,
    outputDir,
    quality,
  );

  if (format === 'json') {
    writeJson(results);
    return;
  }

  for (const item of results) {
    if (item.ok) {
      writeLine(`downloaded: ${item.outputPath}`);
      continue;
    }

    writeLine(`failed: ${item.url} | ${item.error}`);
  }
};

const runDirectDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const urls = [...getMany(parsed, 'url'), ...parsed.positionals].filter(Boolean);
  const quality = getNumber(parsed, 'quality', DEFAULT_DOWNLOAD_QUALITY);
  const outputDir = getString(parsed, 'output', 'downloads');
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';

  if (urls.length === 0) {
    fail('at least one --url is required');
  }

  const batch = await xvideos.videos.detailsMany(
    urls.map((url) => ({ url })),
    {
      concurrency: 2,
      retries: 1,
      retryDelayMs: 500,
      minDelayMs: 0,
    },
  );

  const outputs: Array<
    | {
        ok: true;
        details: VideoDetailsResult;
        outputPath: string;
        sourceUrl: string;
      }
    | {
        ok: false;
        error: string;
        url: string;
      }
  > = [];

  for (const [index, item] of batch.items.entries()) {
    if (!item.ok) {
      outputs.push({
        ok: false,
        error: item.error.message,
        url: item.input.url,
      });
      continue;
    }

    try {
      const downloaded = await downloadVideo({
        details: item.value,
        outputDir,
        quality,
        index: index + 1,
      });
      outputs.push({
        ok: true,
        details: downloaded.details,
        outputPath: downloaded.outputPath,
        sourceUrl: downloaded.sourceUrl,
      });
    } catch (error) {
      outputs.push({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        url: item.value.url,
      });
    }
  }

  if (format === 'json') {
    writeJson(outputs);
    return;
  }

  for (const item of outputs) {
    if (item.ok) {
      writeLine(`downloaded: ${item.outputPath}`);
      continue;
    }

    writeLine(`failed: ${item.url} | ${item.error}`);
  }
};

const printHelp = (): void => {
  writeLine('xvd-dl commands:');
  writeLine('  search --query <term> [--page N] [--limit N] [--json]');
  writeLine('  download --query <term> [--page N] [--limit N] [--output dir] [--quality 480] [--json]');
  writeLine('  direct-download --url <video url> [--url ...] [--output dir] [--quality 480] [--json]');
};

export const main = async (argv = process.argv.slice(2)): Promise<void> => {
  const parsed = parseArgv(argv);

  switch (parsed.command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'search':
      await runSearchCommand(parsed);
      return;
    case 'download':
      await runDownloadCommand(parsed);
      return;
    case 'direct-download':
      await runDirectDownloadCommand(parsed);
      return;
    default:
      fail(`Unknown command: ${parsed.command}`);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
