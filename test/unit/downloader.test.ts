import { describe, expect, it } from 'vitest';

import { DEFAULT_DOWNLOAD_QUALITY, pickDownloadSource } from '../../src/downloader.js';
import type { VideoDetailsResult } from '../../src/types/videos.js';

const buildDetails = (overrides: Partial<VideoDetailsResult> = {}): VideoDetailsResult => {
  return {
    title: 'Sample Title',
    url: 'https://www.xvideos.com/video123/sample',
    videoId: 'video123',
    duration: '1 min',
    durationSeconds: 60,
    thumbnailUrls: ['https://cdn.example/thumb.jpg'],
    watchCount: 10,
    voteCount: 1,
    ratingPercent: 99,
    videoType: 'video/mp4',
    videoWidth: '1280',
    videoHeight: '720',
    uploadDate: '2026-04-27T00:00:00+00:00',
    description: '',
    contentUrl: 'https://cdn.example/content.mp4',
    tags: [],
    categories: [],
    files: {
      low: 'https://cdn.example/low.mp4',
      high: 'https://cdn.example/high.mp4',
      HLS: 'https://cdn.example/master.m3u8',
      thumb: 'https://cdn.example/thumb.jpg',
      thumb69: '',
      thumbSlide: '',
      thumbSlideBig: '',
    },
    ...overrides,
  };
};

describe('downloader helpers', () => {
  it('defaults to 480 quality', () => {
    expect(DEFAULT_DOWNLOAD_QUALITY).toBe(480);
  });

  it('prefers the low stream for 480 quality', () => {
    expect(pickDownloadSource(buildDetails(), 480)).toBe(
      'https://cdn.example/low.mp4',
    );
  });

  it('prefers the high stream for 720 quality', () => {
    expect(pickDownloadSource(buildDetails(), 720)).toBe(
      'https://cdn.example/high.mp4',
    );
  });

  it('falls back to contentUrl when no direct stream exists', () => {
    const details = buildDetails({
      files: {
        low: '',
        high: '',
        HLS: '',
        thumb: 'https://cdn.example/thumb.jpg',
        thumb69: '',
        thumbSlide: '',
        thumbSlideBig: '',
      },
    });

    expect(pickDownloadSource(details, 480)).toBe(
      'https://cdn.example/content.mp4',
    );
  });
});

