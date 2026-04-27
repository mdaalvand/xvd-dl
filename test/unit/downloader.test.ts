import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOWNLOAD_QUALITY,
  buildFormatSelector,
  buildYtDlpArgs,
  parseDownloadQuality,
} from '../../src/downloader.js';

describe('downloader helpers', () => {
  it('defaults to 480 quality', () => {
    expect(DEFAULT_DOWNLOAD_QUALITY).toBe(480);
  });

  it('normalizes quality presets from workflow-friendly labels', () => {
    expect(parseDownloadQuality('480p')).toBe(480);
    expect(parseDownloadQuality('hd')).toBe(720);
    expect(parseDownloadQuality('1080p')).toBe(1080);
    expect(parseDownloadQuality('best')).toBe(9999);
  });

  it('builds the same format selector style as the earlier yt-dlp flow', () => {
    expect(buildFormatSelector(480, false)).toBe(
      'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
    );
    expect(buildFormatSelector(720, false)).toBe(
      'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
    );
    expect(buildFormatSelector(480, true)).toBe('bestaudio/best');
  });

  it('builds yt-dlp args with output numbering and quality cap', () => {
    const args = buildYtDlpArgs({
      url: 'https://www.xvideos.com/video123/sample',
      outputDir: 'downloads',
      quality: 480,
      numberPrefix: '001',
      timeoutMs: 45_000,
    });

    expect(args).toContain('--format');
    expect(args).toContain('bestvideo[height<=480]+bestaudio/best[height<=480]/best');
    expect(args).toContain('--output');
    expect(args).toContain('downloads/001 - %(title)s.%(ext)s');
    expect(args).toContain('--socket-timeout');
    expect(args).toContain('45');
  });
});
