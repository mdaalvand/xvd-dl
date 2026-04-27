#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import xvideos from './index.js';
import {
  DEFAULT_DOWNLOAD_QUALITY,
  downloadBatch,
  parseDownloadQuality,
} from './downloader.js';
import type { VideoSummary } from './types/index.js';

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
};

type OutputFormat = 'text' | 'json';

type SearchFilterSelection = {
  sort?: string;
  datef?: string;
  durf?: string;
  searchQuality?: string;
};

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

  return {
    command: positionals.shift() ?? 'help',
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

const getLimit = (parsed: ParsedArgs, fallback: number): number => {
  const raw = getString(parsed, 'limit', '');
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const resolveSearchFilters = (parsed: ParsedArgs): SearchFilterSelection => {
  const sort = getString(parsed, 'sort', 'all');
  const datef = getString(parsed, 'datef', 'all');
  const durf = getString(parsed, 'durf', 'all');
  const searchQuality = getString(parsed, 'search-quality', 'all');

  return {
    sort: sort === 'all' ? undefined : sort,
    datef: datef === 'all' ? undefined : datef,
    durf: durf === 'all' ? undefined : durf,
    searchQuality: searchQuality === 'all' ? undefined : searchQuality,
  };
};

const writeLine = (value: string): void => {
  process.stdout.write(`${value}\n`);
};

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
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

export const loadSearchResults = async (
  query: string,
  page: number,
  limit: number,
  filters: SearchFilterSelection,
): Promise<VideoSummary[]> => {
  const results: VideoSummary[] = [];
  const seen = new Set<string>();
  let currentPage = page;

  while (results.length < limit) {
    const searchOptions: Record<string, string | number | undefined> = {
      k: query,
      page: currentPage,
      sort: filters.sort,
      datef: filters.datef,
      durf: filters.durf,
      quality: filters.searchQuality,
    };
    let list;
    try {
      list = await xvideos.videos.search(searchOptions);
    } catch (error) {
      if (currentPage === page) {
        throw error;
      }

      break;
    }
    const freshVideos = list.videos.filter((video) => {
      if (seen.has(video.url)) {
        return false;
      }
      seen.add(video.url);
      return true;
    });

    results.push(...freshVideos);

    if (results.length >= limit || !list.hasNext()) {
      break;
    }

    currentPage += 1;
  }

  return results.slice(0, limit);
};

type DownloadJsonItem =
  | {
      ok: true;
      url: string;
      outputPath: string;
    }
  | {
      ok: false;
      url: string;
      error: string;
    };

const runDownloadLikeCommand = async (
  urls: string[],
  outputDir: string,
  quality: number | string,
  format: OutputFormat,
): Promise<void> => {
  const outputs = await downloadBatch(
    urls.map((url, index) => ({
      url,
      outputDir,
      quality,
      numberPrefix: String(index + 1).padStart(3, '0'),
    })),
  );

  if (format === 'json') {
    const payload: DownloadJsonItem[] = [
      ...outputs.succeeded.map((item) => ({
        ok: true as const,
        url: item.url,
        outputPath: item.outputPath,
      })),
      ...outputs.failed.map((item) => ({
        ok: false as const,
        url: item.url,
        error: item.reason,
      })),
    ];
    writeJson(payload);
    return;
  }

  for (const item of outputs.succeeded) {
    writeLine(`downloaded: ${item.outputPath}`);
  }

  for (const item of outputs.failed) {
    writeLine(`failed: ${item.url} | ${item.reason}`);
  }
};

const runSearchCommand = async (parsed: ParsedArgs): Promise<void> => {
  const query = resolveQuery(parsed);
  if (!query) {
    fail('query is required');
  }

  const page = getNumber(parsed, 'page', 1);
  const limit = getLimit(parsed, 100);
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';
  const filters = resolveSearchFilters(parsed);
  const videos = await loadSearchResults(query, page, limit, filters);
  outputSearchResults(videos, format);
};

const runDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const query = resolveQuery(parsed);
  if (!query) {
    fail('query is required');
  }

  const page = getNumber(parsed, 'page', 1);
  const limit = getLimit(parsed, 100);
  const outputDir = getString(parsed, 'output', 'downloads');
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';
  const filters = resolveSearchFilters(parsed);
  const results = await loadSearchResults(query, page, limit, filters);
  await runDownloadLikeCommand(
    results.map((video) => video.url),
    outputDir,
    parseDownloadQuality(getString(parsed, 'quality', DEFAULT_DOWNLOAD_QUALITY.toString())),
    format,
  );
};

const runDirectDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const urls = [...(parsed.flags.get('url') ?? []), ...parsed.positionals].filter(Boolean);
  if (urls.length === 0) {
    fail('at least one --url is required');
  }

  const quality = parseDownloadQuality(getString(parsed, 'quality', DEFAULT_DOWNLOAD_QUALITY.toString()));
  const outputDir = getString(parsed, 'output', 'downloads');
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';
  await runDownloadLikeCommand(urls, outputDir, quality, format);
};

const printHelp = (): void => {
  writeLine('xvd-dl commands:');
  writeLine('  search --query <term> [--page N] [--limit N] [--sort all] [--datef all] [--durf all] [--search-quality all] [--json]');
  writeLine('  download --query <term> [--page N] [--limit N] [--output dir] [--quality 480p|720p|1080p|best] [--sort all] [--datef all] [--durf all] [--search-quality all] [--json]');
  writeLine('  direct-download --url <video url> [--url ...] [--output dir] [--quality 480p|720p|1080p|best] [--json]');
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
