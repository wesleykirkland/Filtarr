/**
 * Barrel export for Arr API clients and types.
 */

export { ArrClient } from './client.js';
export { SonarrClient } from './sonarr.js';
export { RadarrClient } from './radarr.js';
export { LidarrClient } from './lidarr.js';
export { ReadarrClient } from './readarr.js';

export type {
  ArrType,
  ArrInstanceConfig,
  ArrInstanceResponse,
  ArrClientOptions,
  SystemStatusResource,
  HealthResource,
  QueueResource,
  PagingResource,
  BlocklistResource,
  CommandResource,
  CommandBody,
  DeleteQueueOptions,
  ConnectionTestResult,
  SeriesResource,
  MovieResource,
  ArtistResource,
  AlbumResource,
  AuthorResource,
  BookResource,
} from './types.js';

export { ArrApiError, ArrConnectionError } from './types.js';
