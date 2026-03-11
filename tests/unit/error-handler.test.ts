import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/server/lib/logger.js', () => ({ logger: { error: state.error, debug: state.debug } }));

import { errorHandler } from '../../src/server/middleware/errorHandler.js';

describe('errorHandler', () => {
  beforeEach(() => {
    state.error.mockReset();
    state.debug.mockReset();
  });

  it('hides internal error messages and logs them at error level', () => {
    const req = { path: '/api/v1/jobs', method: 'POST' } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;

    errorHandler(new Error('boom') as any, req, res, vi.fn());

    expect(state.error).toHaveBeenCalledWith({ err: expect.any(Error), path: '/api/v1/jobs', method: 'POST' }, 'Unhandled error');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Internal Server Error', code: 'INTERNAL_ERROR' },
    });
  });

  it('returns explicit api errors verbatim and logs them at debug level', () => {
    const req = { path: '/api/v1/settings', method: 'PUT' } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const error = Object.assign(new Error('Validation failed'), { statusCode: 400, code: 'BAD_INPUT' });

    errorHandler(error, req, res, vi.fn());

    expect(state.debug).toHaveBeenCalledWith({ err: error, path: '/api/v1/settings', method: 'PUT' }, 'API error');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Validation failed', code: 'BAD_INPUT' },
    });
  });
});