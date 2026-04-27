import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { VideoDetailsResult } from './types/videos.js';

export const DEFAULT_DOWNLOAD_QUALITY = 480;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const HTTP_URL_PATTERN = /^https?:\/\//i;

export type DownloadInput = {
  details: VideoDetailsResult;
  outputDir: string;
  quality?: number;
  index?: number;
  timeoutMs?: number;
};

export type DownloadOutcome = {
  details: VideoDetailsResult;
  outputPath: string;
  sourceUrl: string;
};

const sanitizeSegment = (value: string): string => {
  return value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 120);
};

const isHttpUrl = (value: string): boolean => {
  return HTTP_URL_PATTERN.test(value);
};

export const pickDownloadSource = (
  details: VideoDetailsResult,
  quality = DEFAULT_DOWNLOAD_QUALITY,
): string => {
  const candidates = (() => {
    if (quality <= 480) {
      return [details.files.low, details.contentUrl, details.files.high];
    }

    if (quality <= 720) {
      return [details.files.high, details.contentUrl, details.files.low];
    }

    return [details.contentUrl, details.files.high, details.files.low];
  })();

  for (const candidate of candidates) {
    if (candidate && isHttpUrl(candidate)) {
      return candidate;
    }
  }

  return '';
};

const resolveFileName = (
  details: VideoDetailsResult,
  index: number,
  sourceUrl: string,
): string => {
  const baseName = [
    index > 0 ? String(index).padStart(3, '0') : '',
    details.videoId || 'video',
    details.title ? sanitizeSegment(details.title) : '',
  ]
    .filter(Boolean)
    .join('-');

  const extension = extname(new URL(sourceUrl).pathname) || '.mp4';

  return `${baseName || 'video'}${extension}`;
};

export const downloadVideo = async ({
  details,
  outputDir,
  quality = DEFAULT_DOWNLOAD_QUALITY,
  index = 0,
  timeoutMs = 120_000,
}: DownloadInput): Promise<DownloadOutcome> => {
  const sourceUrl = pickDownloadSource(details, quality);

  if (!sourceUrl) {
    throw new Error(`No downloadable source found for ${details.url}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, resolveFileName(details, index, sourceUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'user-agent': DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch media: ${response.status} ${response.statusText}`,
      );
    }

    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(outputPath),
    );

    return {
      details,
      outputPath,
      sourceUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
};
