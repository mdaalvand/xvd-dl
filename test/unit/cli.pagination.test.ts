import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/index.js', () => {
  return {
    default: {
      videos: {
        search: searchMock,
      },
    },
  };
});

const { loadSearchResults } = await import('../../src/cli.js');

describe('cli pagination', () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it('paginates until the requested limit is collected', async () => {
    searchMock
      .mockResolvedValueOnce({
        videos: [
          { url: 'u1', title: 'one' },
          { url: 'u2', title: 'two' },
        ],
        hasNext: () => true,
      })
      .mockResolvedValueOnce({
        videos: [
          { url: 'u3', title: 'three' },
          { url: 'u4', title: 'four' },
        ],
        hasNext: () => true,
      })
      .mockResolvedValueOnce({
        videos: [{ url: 'u5', title: 'five' }],
        hasNext: () => false,
      });

    const videos = await loadSearchResults(
      'gay latino',
      1,
      4,
      {},
    );

    expect(videos.map((video) => video.url)).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1 }));
    expect(searchMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
  });

  it('stops cleanly when a later page fails', async () => {
    searchMock
      .mockResolvedValueOnce({
        videos: [
          { url: 'u1', title: 'one' },
          { url: 'u2', title: 'two' },
        ],
        hasNext: () => true,
      })
      .mockRejectedValueOnce(new Error('page 2 missing'));

    const videos = await loadSearchResults('gay latino', 1, 4, {});

    expect(videos.map((video) => video.url)).toEqual(['u1', 'u2']);
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list when the first page fails', async () => {
    searchMock.mockRejectedValueOnce(new Error('page 1 missing'));

    const videos = await loadSearchResults('gay latino', 1, 4, {});

    expect(videos).toEqual([]);
    expect(searchMock).toHaveBeenCalledTimes(1);
  });
});
