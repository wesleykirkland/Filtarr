import type Database from 'better-sqlite3';
import { createEvent, type CreateEventInput } from '../../db/schemas/events.js';
import { logger } from './logger.js';

export function recordActivityEvent(db: Database.Database, input: CreateEventInput): void {
  try {
    createEvent(db, input);
  } catch (error) {
    logger.warn({ err: error, event: input }, 'Failed to record activity event');
  }
}