import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { getProtectedRouteState } from '../../src/client/lib/session';

describe('getProtectedRouteState', () => {
  it('allows authenticated and auth-disabled sessions', () => {
    expect(getProtectedRouteState({ session: { authenticated: true }, error: null })).toEqual({
      state: 'allow',
    });
    expect(getProtectedRouteState({ session: { mode: 'none' }, error: null })).toEqual({
      state: 'allow',
    });
  });

  it('returns retry details for non-401 API errors', () => {
    const limited = getProtectedRouteState({
      session: undefined,
      error: new ApiError(429, 'Rate limited'),
    });
    expect(limited).toMatchObject({ state: 'retry', title: 'Session check is being rate limited' });

    const generic = getProtectedRouteState({
      session: undefined,
      error: new ApiError(500, 'Server error'),
    });
    expect(generic).toMatchObject({ state: 'retry', title: 'Unable to verify session' });
  });

  it('falls back to login for missing or unauthorized sessions', () => {
    expect(getProtectedRouteState({ session: undefined, error: null })).toEqual({ state: 'login' });
    expect(
      getProtectedRouteState({
        session: { authenticated: false, mode: 'forms' },
        error: new ApiError(401, 'Unauthorized'),
      }),
    ).toEqual({ state: 'login' });
  });
});