import { ApiError } from './api';

interface SessionLike {
  authenticated?: boolean;
  mode?: string;
}

export function getProtectedRouteState({
  session,
  error,
}: {
  session: SessionLike | undefined;
  error: unknown;
}) {
  if (session?.authenticated || session?.mode === 'none') {
    return { state: 'allow' as const };
  }

  if (error instanceof ApiError && error.status !== 401) {
    return {
      state: 'retry' as const,
      title:
        error.status === 429 ? 'Session check is being rate limited' : 'Unable to verify session',
      description:
        error.status === 429
          ? 'Filtarr hit a temporary auth-session limit. Retry in a moment instead of forcing you back to the login screen.'
          : 'Filtarr could not confirm your current session because of a temporary network or server error.',
    };
  }

  return { state: 'login' as const };
}