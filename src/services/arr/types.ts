/**
 * Shared TypeScript types for Arr API v3 (Sonarr, Radarr, Lidarr).
 */

// ── Instance Types ──────────────────────────────────────────────────────────

export type ArrType = 'sonarr' | 'radarr' | 'lidarr';

export interface ArrInstanceConfig {
  id: number;
  name: string;
  type: ArrType;
  url: string;
  apiKey: string;
  timeout: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArrInstanceResponse {
  id: number;
  name: string;
  type: ArrType;
  url: string;
  apiKey: string; // masked: "••••••••abcd"
  timeout: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── System Status ───────────────────────────────────────────────────────────

export interface SystemStatusResource {
  appName: string;
  instanceName: string;
  version: string;
  buildTime: string;
  isDebug: boolean;
  isProduction: boolean;
  isAdmin: boolean;
  isUserInteractive: boolean;
  startupPath: string;
  appData: string;
  osName: string;
  osVersion: string;
  isDocker: boolean;
  branch: string;
  authentication: string;
  urlBase: string;
  runtimeVersion: string;
  runtimeName: string;
  startTime: string;
  packageVersion: string;
}

// ── Health ───────────────────────────────────────────────────────────────────

export type HealthCheckType = 'ok' | 'notice' | 'warning' | 'error';

export interface HealthResource {
  source: string;
  type: HealthCheckType;
  message: string;
  wikiUrl: string;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export type QueueStatus =
  | 'unknown' | 'queued' | 'paused' | 'downloading' | 'completed'
  | 'failed' | 'warning' | 'delay' | 'downloadClientUnavailable' | 'fallback';

export type TrackedDownloadState =
  | 'downloading' | 'importPending' | 'importing' | 'imported'
  | 'failedPending' | 'failed' | 'ignored';

export interface StatusMessage {
  title: string;
  messages: string[];
}

export interface QueueResource {
  id: number;
  downloadId: string;
  title: string;
  size: number;
  sizeleft: number;
  status: QueueStatus;
  trackedDownloadState: TrackedDownloadState;
  trackedDownloadStatus: string;
  statusMessages: StatusMessage[];
  errorMessage: string;
  downloadClient: string;
  outputPath: string;
  indexer: string;
  protocol: string;
  timeleft: string;
  estimatedCompletionTime: string;
  added: string;
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  movieId?: number;
  artistId?: number;
  albumId?: number;
}

export interface PagingResource<T> {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: 'ascending' | 'descending' | 'default';
  totalRecords: number;
  records: T[];
}

// ── Blocklist ────────────────────────────────────────────────────────────────

export interface Language {
  id: number;
  name: string;
}

export interface Quality {
  id: number;
  name: string;
  source: string;
  resolution: number;
}

export interface Revision {
  version: number;
  real: number;
  isRepack: boolean;
}

export interface QualityModel {
  quality: Quality;
  revision: Revision;
}

export interface BlocklistResource {
  id: number;
  seriesId?: number;
  movieId?: number;
  artistId?: number;
  episodeIds?: number[];
  sourceTitle: string;
  languages: Language[];
  quality: QualityModel;
  date: string;
  protocol: string;
  indexer: string;
  message: string;
}

// ── Command ──────────────────────────────────────────────────────────────────

export type CommandStatus = 'queued' | 'started' | 'completed' | 'failed' | 'cancelled';

export interface CommandResource {
  id: number;
  name: string;
  commandName: string;
  message: string;
  body: Record<string, unknown>;
  priority: string;
  status: CommandStatus;
  queued: string;
  started: string;
  ended: string;
  stateChangeTime: string;
  lastExecutionTime: string;
  duration: string;
  trigger: string;
}

export interface CommandBody {
  name: string;
  [key: string]: unknown;
}

// ── Series (Sonarr) ──────────────────────────────────────────────────────────

export interface MediaImage {
  coverType: string;
  url: string;
  remoteUrl: string;
}

export interface Season {
  seasonNumber: number;
  monitored: boolean;
}

export interface SeriesResource {
  id: number;
  title: string;
  sortTitle: string;
  status: string;
  overview: string;
  network: string;
  airTime: string;
  images: MediaImage[];
  seasons: Season[];
  year: number;
  path: string;
  qualityProfileId: number;
  languageProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  tvdbId: number;
  imdbId: string;
  titleSlug: string;
  seriesType: string;
  added: string;
  tags: number[];
}

// ── Movie (Radarr) ───────────────────────────────────────────────────────────

export interface MovieResource {
  id: number;
  title: string;
  sortTitle: string;
  status: string;
  overview: string;
  year: number;
  path: string;
  qualityProfileId: number;
  monitored: boolean;
  tmdbId: number;
  imdbId: string;
  titleSlug: string;
  added: string;
  images: MediaImage[];
  tags: number[];
  hasFile: boolean;
  isAvailable: boolean;
}

// ── Artist/Album (Lidarr) ────────────────────────────────────────────────────

export interface ArtistResource {
  id: number;
  artistName: string;
  sortName: string;
  status: string;
  overview: string;
  path: string;
  qualityProfileId: number;
  metadataProfileId: number;
  monitored: boolean;
  foreignArtistId: string;
  added: string;
  images: MediaImage[];
  tags: number[];
}

export interface AlbumResource {
  id: number;
  title: string;
  artistId: number;
  foreignAlbumId: string;
  monitored: boolean;
  releaseDate: string;
  images: MediaImage[];
}

// ── Client Configuration ─────────────────────────────────────────────────────

export interface ArrClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout?: number;   // ms, default 30000
  maxRetries?: number; // default 3
}

// ── API Errors ───────────────────────────────────────────────────────────────

export class ArrApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly url: string,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'ArrApiError';
  }
}

export class ArrConnectionError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ArrConnectionError';
  }
}

// ── Delete Queue Options ─────────────────────────────────────────────────────

export interface DeleteQueueOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
  skipRedownload?: boolean;
  changeCategory?: boolean;
}

// ── Connection Test Result ───────────────────────────────────────────────────

export interface ConnectionTestResult {
  success: boolean;
  appName?: string;
  appVersion?: string;
  error?: string;
}
