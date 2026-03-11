import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  createEvent: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/db/schemas/events.js', () => ({ createEvent: state.createEvent }));
vi.mock('../../src/server/lib/logger.js', () => ({ logger: { warn: state.warn } }));

import { recordActivityEvent } from '../../src/server/lib/activity.js';

describe('recordActivityEvent', () => {
  beforeEach(() => {
    state.createEvent.mockReset();
    state.warn.mockReset();
  });

  it('writes events through the schema helper', () => {
    const db = {} as any;
    const input = { type: 'run', source: 'jobs', message: 'Started', details: { jobId: 1 } };

    recordActivityEvent(db, input as any);

    expect(state.createEvent).toHaveBeenCalledWith(db, input);
    expect(state.warn).not.toHaveBeenCalled();
  });

  it('logs a warning instead of throwing when event recording fails', () => {
    const error = new Error('disk full');
    state.createEvent.mockImplementation(() => {
      throw error;
    });
    const input = { type: 'validation', source: 'instances', message: 'Failed' };

    expect(() => recordActivityEvent({} as any, input as any)).not.toThrow();
    expect(state.warn).toHaveBeenCalledWith({ err: error, event: input }, 'Failed to record activity event');
  });
});