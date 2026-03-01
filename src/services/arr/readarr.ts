/**
 * Readarr-specific API client.
 * Extends the base ArrClient with book-specific operations.
 */

import { ArrClient } from './client.js';
import type { AuthorResource, BookResource, CommandResource, CommandBody } from './types.js';

export class ReadarrClient extends ArrClient {
  /** GET /api/v1/author — list all authors (Readarr uses v1) */
  async getAuthors(): Promise<AuthorResource[]> {
    return this.get<AuthorResource[]>('/api/v1/author');
  }

  /** GET /api/v1/author/{id} — get a single author */
  async getAuthorById(id: number): Promise<AuthorResource> {
    return this.get<AuthorResource>(`/api/v1/author/${id}`);
  }

  /** GET /api/v1/book — list all books */
  async getBooks(authorId?: number): Promise<BookResource[]> {
    const params = authorId !== undefined ? { authorId } : undefined;
    return this.get<BookResource[]>('/api/v1/book', params);
  }

  /** POST /api/v1/command — trigger RefreshAuthor */
  async refreshAuthor(authorId?: number): Promise<CommandResource> {
    const body: CommandBody = { name: 'RefreshAuthor' };
    if (authorId !== undefined) body['authorId'] = authorId;
    return this.post<CommandResource>('/api/v1/command', body);
  }

  /** POST /api/v1/command — trigger AuthorSearch */
  async searchAuthor(authorId: number): Promise<CommandResource> {
    return this.post<CommandResource>('/api/v1/command', { name: 'AuthorSearch', authorId });
  }

  /** POST /api/v1/command — trigger BookSearch */
  async searchBook(bookId: number): Promise<CommandResource> {
    return this.post<CommandResource>('/api/v1/command', { name: 'BookSearch', bookId });
  }

  // Override base endpoints to use v1 API for Readarr
  override async getHealth() {
    return this.get<import('./types.js').HealthResource[]>('/api/v1/health');
  }

  override async getSystemStatus() {
    return this.get<import('./types.js').SystemStatusResource>('/api/v1/system/status');
  }

  override async getQueue(page = 1, pageSize = 20) {
    return this.get<import('./types.js').PagingResource<import('./types.js').QueueResource>>('/api/v1/queue', {
      page, pageSize, sortKey: 'timeleft', sortDirection: 'ascending',
    });
  }

  override async deleteQueueItem(id: number, options: import('./types.js').DeleteQueueOptions = {}) {
    const params: Record<string, string | number | boolean> = {};
    if (options.removeFromClient !== undefined) params['removeFromClient'] = options.removeFromClient;
    if (options.blocklist !== undefined) params['blocklist'] = options.blocklist;
    if (options.skipRedownload !== undefined) params['skipRedownload'] = options.skipRedownload;
    await this.delete(`/api/v1/queue/${id}`, params);
  }

  override async getBlocklist(page = 1, pageSize = 20) {
    return this.get<import('./types.js').PagingResource<import('./types.js').BlocklistResource>>('/api/v1/blocklist', {
      page, pageSize, sortKey: 'date', sortDirection: 'descending',
    });
  }
}
