#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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

const SORT_OPTIONS = ['relevance', 'rating', 'views', 'duration', 'upload_date'] as const;
const DATEF_OPTIONS = ['all', 'day', 'week', 'month', 'year'] as const;
const DURF_OPTIONS = ['allduration', '0-1min', '1-3min', '3-10min', '10-20min', '20min+'] as const;
const QUALITY_OPTIONS = ['all', 'hd', '1080p', '720p', '480p'] as const;

type SearchFilterSelection = {
  sort: string;
  datef: string;
  durf: string;
  searchQuality: string;
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

const getLimit = (parsed: ParsedArgs, fallback: number | 'all'): number | 'all' => {
  const raw = getString(parsed, 'limit', '');
  if (!raw) {
    return fallback;
  }

  if (raw.trim().toLowerCase() === 'all') {
    return 'all';
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getMany = (parsed: ParsedArgs, name: string): string[] => {
  return parsed.flags.get(name) ?? [];
};

const hasInteractiveInput = (): boolean => {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
};

const createPrompter = (): ReturnType<typeof createInterface> => {
  return createInterface({ input, output });
};

const chooseFromMenu = async (
  label: string,
  options: readonly string[],
  fallback: string,
): Promise<string> => {
  if (!hasInteractiveInput()) {
    return fallback;
  }

  const rl = createPrompter();
  try {
    writeLine(label);
    for (const [index, option] of options.entries()) {
      writeLine(`  ${index + 1}. ${option}`);
    }

    const answer = (await rl.question(`Select 1-${options.length} [${fallback}]: `)).trim();
    if (!answer) {
      return fallback;
    }

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }

    return fallback;
  } finally {
    rl.close();
  }
};

const resolveSearchFilters = async (parsed: ParsedArgs): Promise<SearchFilterSelection> => {
  const sort = getString(parsed, 'sort', '');
  const datef = getString(parsed, 'datef', '');
  const durf = getString(parsed, 'durf', '');
  const searchQuality = getString(parsed, 'search-quality', '');

  return {
    sort: sort || (await chooseFromMenu('Sort by:', SORT_OPTIONS, 'rating')),
    datef: datef || (await chooseFromMenu('Date range:', DATEF_OPTIONS, 'week')),
    durf: durf || (await chooseFromMenu('Duration:', DURF_OPTIONS, '3-10min')),
    searchQuality:
      searchQuality || (await chooseFromMenu('Search quality:', QUALITY_OPTIONS, 'hd')),
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

const loadSearchResults = async (
  query: string,
  page: number,
  limit: number | 'all',
  filters: SearchFilterSelection,
): Promise<VideoSummary[]> => {
  const list = await xvideos.videos.search({
    k: query,
    page,
    sort: filters.sort,
    datef: filters.datef,
    durf: filters.durf,
    quality: filters.searchQuality,
  });
  return limit === 'all' ? list.videos : list.videos.slice(0, limit);
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
  const limit = getLimit(parsed, 10);
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';
  const filters = await resolveSearchFilters(parsed);
  const videos = await loadSearchResults(query, page, limit, filters);
  outputSearchResults(videos, format);
};

const runDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const query = resolveQuery(parsed);
  if (!query) {
    fail('query is required');
  }

  const page = getNumber(parsed, 'page', 1);
  const limit = getLimit(parsed, 1);
  const outputDir = getString(parsed, 'output', 'downloads');
  const format: OutputFormat = parsed.booleans.has('json') ? 'json' : 'text';
  const filters = await resolveSearchFilters(parsed);
  const results = await loadSearchResults(query, page, limit, filters);
  await runDownloadLikeCommand(
    results.map((video) => video.url),
    outputDir,
    parseDownloadQuality(getString(parsed, 'quality', DEFAULT_DOWNLOAD_QUALITY.toString())),
    format,
  );
};

const runDirectDownloadCommand = async (parsed: ParsedArgs): Promise<void> => {
  const urls = [...getMany(parsed, 'url'), ...parsed.positionals].filter(Boolean);
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
  writeLine('  search --query <term> [--page N] [--limit N|all] [--sort rating] [--datef week] [--durf 3-10min] [--search-quality hd] [--json]');
  writeLine('  download --query <term> [--page N] [--limit N|all] [--output dir] [--quality 480p|720p|1080p|best] [--sort rating] [--datef week] [--durf 3-10min] [--search-quality hd] [--json]');
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
