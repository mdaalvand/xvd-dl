import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_DOWNLOAD_QUALITY = 480;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export type DownloadInput = {
  url: string;
  outputDir: string;
  quality?: number;
  audioOnly?: boolean;
  numberPrefix?: string;
  timeoutMs?: number;
};

export type DownloadOutcome = {
  url: string;
  outputPath: string;
};

export type DownloadFailure = {
  url: string;
  reason: string;
};

export type DownloadResult = {
  succeeded: DownloadOutcome[];
  failed: DownloadFailure[];
};

const buildOutputTemplate = (outputDir: string, numberPrefix = ''): string => {
  const prefix = numberPrefix ? `${numberPrefix} - ` : '';
  return join(outputDir, `${prefix}%(title)s.%(ext)s`);
};

export const buildFormatSelector = (
  quality = DEFAULT_DOWNLOAD_QUALITY,
  audioOnly = false,
): string => {
  if (audioOnly) {
    return 'bestaudio/best';
  }

  return `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
};

export const buildYtDlpArgs = ({
  url,
  outputDir,
  quality = DEFAULT_DOWNLOAD_QUALITY,
  audioOnly = false,
  numberPrefix = '',
  timeoutMs = 120_000,
}: DownloadInput): string[] => {
  const socketTimeout = String(Math.max(30, Math.ceil(timeoutMs / 1000)));
  const args = [
    '--no-progress',
    '--newline',
    '--quiet',
    '--retries',
    '3',
    '--fragment-retries',
    '8',
    '--socket-timeout',
    socketTimeout,
    '--user-agent',
    DEFAULT_USER_AGENT,
    '--add-header',
    'Referer: https://www.xvideos.com/',
    '--add-header',
    'Origin: https://www.xvideos.com',
    '--format',
    buildFormatSelector(quality, audioOnly),
    '--output',
    buildOutputTemplate(outputDir, numberPrefix),
    '--merge-output-format',
    'mp4',
    '--print',
    'after_move:filepath',
    url,
  ];

  if (audioOnly) {
    return args;
  }

  return args;
};

const runYtDlp = async (args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> => {
  return await new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
};

const resolveOutputPath = (stdout: string): string => {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? '';
};

export const downloadVideo = async ({
  url,
  outputDir,
  quality = DEFAULT_DOWNLOAD_QUALITY,
  audioOnly = false,
  numberPrefix = '',
  timeoutMs = 120_000,
}: DownloadInput): Promise<DownloadOutcome> => {
  await mkdir(outputDir, { recursive: true });
  const args = buildYtDlpArgs({
    url,
    outputDir,
    quality,
    audioOnly,
    numberPrefix,
    timeoutMs,
  });
  const { stdout } = await runYtDlp(args, timeoutMs);
  const outputPath = resolveOutputPath(stdout);

  if (!outputPath) {
    throw new Error(`yt-dlp did not report an output path for ${url}`);
  }

  return {
    url,
    outputPath,
  };
};

export const downloadBatch = async (
  inputs: DownloadInput[],
): Promise<DownloadResult> => {
  const succeeded: DownloadOutcome[] = [];
  const failed: DownloadFailure[] = [];

  for (const input of inputs) {
    try {
      const item = await downloadVideo(input);
      succeeded.push(item);
    } catch (error) {
      failed.push({
        url: input.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    succeeded,
    failed,
  };
};

