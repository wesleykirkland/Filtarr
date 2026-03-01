/**
 * Sonarr-specific API client.
 * Extends the base ArrClient with series-specific operations.
 */

import { ArrClient } from './client.js';
import type { SeriesResource, CommandResource, CommandBody } from './types.js';

export class SonarrClient extends ArrClient {
  /** GET /api/v3/series — list all series */
  async getSeries(): Promise<SeriesResource[]> {
    return this.get<SeriesResource[]>('/api/v3/series');
  }

  /** GET /api/v3/series/{id} — get a single series */
  async getSeriesById(id: number): Promise<SeriesResource> {
    return this.get<SeriesResource>(`/api/v3/series/${id}`);
  }

  /** POST /api/v3/command — trigger RescanSeries */
  async rescanSeries(seriesId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RescanSeries' };
    if (seriesId !== undefined) body['seriesId'] = seriesId;
    return this.executeCommand(body);
  }

  /** POST /api/v3/command — trigger SeriesSearch */
  async searchSeries(seriesId: number): Promise<CommandResource> {
    return this.executeCommand({ name: 'SeriesSearch', seriesId });
  }

  /** POST /api/v3/command — trigger SeasonSearch */
  async searchSeason(seriesId: number, seasonNumber: number): Promise<CommandResource> {
    return this.executeCommand({ name: 'SeasonSearch', seriesId, seasonNumber });
  }

  /** POST /api/v3/command — trigger EpisodeSearch */
  async searchEpisodes(episodeIds: number[]): Promise<CommandResource> {
    return this.executeCommand({ name: 'EpisodeSearch', episodeIds });
  }

  /** POST /api/v3/command — trigger RefreshSeries */
  async refreshSeries(seriesId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RefreshSeries' };
    if (seriesId !== undefined) body['seriesId'] = seriesId;
    return this.executeCommand(body);
  }
}
