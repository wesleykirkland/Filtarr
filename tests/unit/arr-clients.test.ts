import { describe, expect, it, vi } from 'vitest';
import {
  ArrApiError,
  ArrClient,
  ArrConnectionError,
  LidarrClient,
  RadarrClient,
  SonarrClient,
} from '../../src/services/arr/index.js';

describe('arr wrapper clients', () => {
  it('re-exports the shared arr types and client classes from the barrel', () => {
    expect(ArrClient).toBeTypeOf('function');
    expect(SonarrClient).toBeTypeOf('function');
    expect(RadarrClient).toBeTypeOf('function');
    expect(LidarrClient).toBeTypeOf('function');
    expect(ArrApiError).toBeTypeOf('function');
    expect(ArrConnectionError).toBeTypeOf('function');
  });

  it('loads the barrel as a namespace module', async () => {
    const arr = await import('../../src/services/arr/index.js');

    expect(Object.keys(arr)).toEqual(
      expect.arrayContaining([
        'ArrApiError',
        'ArrClient',
        'ArrConnectionError',
        'LidarrClient',
        'RadarrClient',
        'SonarrClient',
      ]),
    );
  });

  it('maps sonarr endpoints and command bodies', async () => {
    const client = new SonarrClient({ baseUrl: 'http://example.com', apiKey: 'key' }) as any;
    const get = vi.spyOn(client, 'get').mockResolvedValue({});
    const executeCommand = vi.spyOn(client, 'executeCommand').mockResolvedValue({});

    await client.getSeries();
    await client.getSeriesById(42);
    await client.rescanSeries();
    await client.rescanSeries(7);
    await client.searchSeries(9);
    await client.searchSeason(9, 2);
    await client.searchEpisodes([1, 2]);
    await client.refreshSeries();
    await client.refreshSeries(3);

    expect(get).toHaveBeenCalledWith('/api/v3/series');
    expect(get).toHaveBeenCalledWith('/api/v3/series/42');
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RescanSeries' });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RescanSeries', seriesId: 7 });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'SeriesSearch', seriesId: 9 });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'SeasonSearch', seriesId: 9, seasonNumber: 2 });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'EpisodeSearch', episodeIds: [1, 2] });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RefreshSeries' });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RefreshSeries', seriesId: 3 });
  });

  it('maps radarr endpoints and command bodies', async () => {
    const client = new RadarrClient({ baseUrl: 'http://example.com', apiKey: 'key' }) as any;
    const get = vi.spyOn(client, 'get').mockResolvedValue({});
    const executeCommand = vi.spyOn(client, 'executeCommand').mockResolvedValue({});

    await client.getMovies();
    await client.getMovieById(5);
    await client.rescanMovie();
    await client.rescanMovie(11);
    await client.searchMovies([11, 12]);
    await client.refreshMovie();
    await client.refreshMovie(14);

    expect(get).toHaveBeenCalledWith('/api/v3/movie');
    expect(get).toHaveBeenCalledWith('/api/v3/movie/5');
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RescanMovie' });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RescanMovie', movieId: 11 });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'MoviesSearch', movieIds: [11, 12] });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RefreshMovie' });
    expect(executeCommand).toHaveBeenCalledWith({ name: 'RefreshMovie', movieId: 14 });
  });

  it('uses lidarr v1 endpoints and lidarr-specific queue/blocklist behavior', async () => {
    const client = new LidarrClient({ baseUrl: 'http://example.com', apiKey: 'key' }) as any;
    const get = vi.spyOn(client, 'get').mockResolvedValue({});
    const post = vi.spyOn(client, 'post').mockResolvedValue({});
    const del = vi.spyOn(client, 'delete').mockResolvedValue(undefined);

    await client.getArtists();
    await client.getArtistById(1);
    await client.getAlbums();
    await client.getAlbums(99);
    await client.refreshArtist();
    await client.refreshArtist(2);
    await client.searchArtist(3);
    await client.searchAlbum(4);
    await client.getHealth();
    await client.getSystemStatus();
    await client.getQueue(3, 40);
    await client.deleteQueueItem(8, { removeFromClient: true, blocklist: true, skipRedownload: false });
    await client.getBlocklist(2, 10);

    expect(get).toHaveBeenCalledWith('/api/v1/artist');
    expect(get).toHaveBeenCalledWith('/api/v1/artist/1');
    expect(get).toHaveBeenCalledWith('/api/v1/album', undefined);
    expect(get).toHaveBeenCalledWith('/api/v1/album', { artistId: 99 });
    expect(post).toHaveBeenCalledWith('/api/v1/command', { name: 'RefreshArtist' });
    expect(post).toHaveBeenCalledWith('/api/v1/command', { name: 'RefreshArtist', artistId: 2 });
    expect(post).toHaveBeenCalledWith('/api/v1/command', { name: 'ArtistSearch', artistId: 3 });
    expect(post).toHaveBeenCalledWith('/api/v1/command', { name: 'AlbumSearch', albumId: 4 });
    expect(get).toHaveBeenCalledWith('/api/v1/health');
    expect(get).toHaveBeenCalledWith('/api/v1/system/status');
    expect(get).toHaveBeenCalledWith('/api/v1/queue', {
      page: 3,
      pageSize: 40,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    });
    expect(del).toHaveBeenCalledWith('/api/v1/queue/8', {
      removeFromClient: true,
      blocklist: true,
      skipRedownload: false,
    });
    expect(get).toHaveBeenCalledWith('/api/v1/blocklist', {
      page: 2,
      pageSize: 10,
      sortKey: 'date',
      sortDirection: 'descending',
    });
  });
});