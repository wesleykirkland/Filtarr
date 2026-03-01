/**
 * Radarr-specific API client.
 * Extends the base ArrClient with movie-specific operations.
 */

import { ArrClient } from './client.js';
import type { MovieResource, CommandResource, CommandBody } from './types.js';

export class RadarrClient extends ArrClient {
  /** GET /api/v3/movie — list all movies */
  async getMovies(): Promise<MovieResource[]> {
    return this.get<MovieResource[]>('/api/v3/movie');
  }

  /** GET /api/v3/movie/{id} — get a single movie */
  async getMovieById(id: number): Promise<MovieResource> {
    return this.get<MovieResource>(`/api/v3/movie/${id}`);
  }

  /** POST /api/v3/command — trigger RescanMovie */
  async rescanMovie(movieId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RescanMovie' };
    if (movieId !== undefined) body['movieId'] = movieId;
    return this.executeCommand(body);
  }

  /** POST /api/v3/command — trigger MoviesSearch */
  async searchMovies(movieIds: number[]): Promise<CommandResource> {
    return this.executeCommand({ name: 'MoviesSearch', movieIds });
  }

  /** POST /api/v3/command — trigger RefreshMovie */
  async refreshMovie(movieId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RefreshMovie' };
    if (movieId !== undefined) body['movieId'] = movieId;
    return this.executeCommand(body);
  }
}
