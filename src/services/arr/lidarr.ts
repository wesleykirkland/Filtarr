/**
 * Lidarr-specific API client.
 * Extends the base ArrClient with music-specific operations.
 */

import { ArrClient } from './client.js';
import type {
  ArtistResource,
  AlbumResource,
  CommandResource,
  CommandBody,
  HealthResource,
  SystemStatusResource,
  PagingResource,
  QueueResource,
  DeleteQueueOptions,
  BlocklistResource
} from './types.js';

export class LidarrClient extends ArrClient {
  /** GET /api/v1/artist — list all artists (Lidarr uses v1) */
  async getArtists(): Promise<ArtistResource[]> {
    return this.get<ArtistResource[]>('/api/v1/artist');
  }

  /** GET /api/v1/artist/{id} — get a single artist */
  async getArtistById(id: number): Promise<ArtistResource> {
    return this.get<ArtistResource>(`/api/v1/artist/${id}`);
  }

  /** GET /api/v1/album — list all albums */
  async getAlbums(artistId?: number): Promise<AlbumResource[]> {
    const params = artistId !== undefined ? { artistId } : undefined;
    return this.get<AlbumResource[]>('/api/v1/album', params);
  }

  /** POST /api/v1/command — trigger RefreshArtist */
  async refreshArtist(artistId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RefreshArtist' };
    if (artistId !== undefined) body['artistId'] = artistId;
    return this.post<CommandResource>('/api/v1/command', body);
  }

  /** POST /api/v1/command — trigger ArtistSearch */
  async searchArtist(artistId: number): Promise<CommandResource> {
    return this.post<CommandResource>('/api/v1/command', { name: 'ArtistSearch', artistId });
  }

  /** POST /api/v1/command — trigger AlbumSearch */
  async searchAlbum(albumId: number): Promise<CommandResource> {
    return this.post<CommandResource>('/api/v1/command', { name: 'AlbumSearch', albumId });
  }

  // Override base endpoints to use v1 API for Lidarr
  override async getHealth() {
    return this.get<HealthResource[]>('/api/v1/health');
  }

  override async getSystemStatus() {
    return this.get<SystemStatusResource>('/api/v1/system/status');
  }

  override async getQueue(page = 1, pageSize = 20) {
    return this.get<PagingResource<QueueResource>>(
      '/api/v1/queue',
      {
        page,
        pageSize,
        sortKey: 'timeleft',
        sortDirection: 'ascending',
      },
    );
  }

  override async deleteQueueItem(
    id: number,
    options: DeleteQueueOptions = {},
  ) {
    const params: Record<string, string | number | boolean> = {};
    if (options.removeFromClient !== undefined)
      params['removeFromClient'] = options.removeFromClient;
    if (options.blocklist !== undefined) params['blocklist'] = options.blocklist;
    if (options.skipRedownload !== undefined) params['skipRedownload'] = options.skipRedownload;
    await this.delete(`/api/v1/queue/${id}`, params);
  }

  override async getBlocklist(page = 1, pageSize = 20) {
    return this.get<PagingResource<BlocklistResource>>(
      '/api/v1/blocklist',
      {
        page,
        pageSize,
        sortKey: 'date',
        sortDirection: 'descending',
      },
    );
  }
}
