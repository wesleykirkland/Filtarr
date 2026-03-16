// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import App from '../../src/client/App';
import { click, render, waitFor } from '../support/render';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  authState: {
    session: { authenticated: true, mode: 'forms', user: { username: 'admin', displayName: 'Admin' } },
    isLoading: false,
    error: null as Error | null,
    retrySession: vi.fn(),
  },
}));

vi.mock('../../src/client/lib/api', () => ({ api, ApiError: class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
} }));
vi.mock('../../src/client/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../src/client/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock('../../src/client/components/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div><div>Layout shell</div>{children}</div> }));
vi.mock('../../src/client/pages/Dashboard', () => ({ default: () => <div>Dashboard page</div> }));
vi.mock('../../src/client/pages/Instances', () => ({ default: () => <div>Instances page</div> }));
vi.mock('../../src/client/pages/Filters', () => ({ default: () => <div>Filters page</div> }));
vi.mock('../../src/client/pages/Scheduler', () => ({ default: () => <div>Scheduler page</div> }));
vi.mock('../../src/client/pages/Activity', () => ({ default: () => <div>Activity page</div> }));
vi.mock('../../src/client/pages/Settings', () => ({ default: () => <div>Settings page</div> }));
vi.mock('../../src/client/pages/Login', () => ({ default: () => <div>Login page</div> }));
vi.mock('../../src/client/pages/Setup', () => ({ default: () => <div>Setup page</div> }));

function wrap(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><App /></QueryClientProvider></MemoryRouter>;
}

describe('App shell', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    api.get.mockReset();
    authState.retrySession.mockClear();
    authState.session = { authenticated: true, mode: 'forms', user: { username: 'admin', displayName: 'Admin' } };
    authState.isLoading = false;
    authState.error = null;
  });

  it('redirects to setup when setup is incomplete', async () => {
    api.get.mockResolvedValue({ needsSetup: true });
    const view = await render(wrap('/'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Setup page');
    });
    await view.unmount();
  });

  it('redirects unauthenticated users to login when setup is complete', async () => {
    api.get.mockResolvedValue({ needsSetup: false });
    authState.session = { authenticated: false, mode: 'forms' };
    const view = await render(wrap('/'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Login page');
    });
    await view.unmount();
  });

  it('shows retry UI for transient auth-session failures', async () => {
    api.get.mockResolvedValue({ needsSetup: false });
    authState.session = undefined;
    authState.error = new ApiError(429, 'rate limited');
    const view = await render(wrap('/'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Retry session check');
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Retry session check') ?? null);
    expect(authState.retrySession).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('shows loading shells while setup or auth state is pending', async () => {
    api.get.mockResolvedValue({ needsSetup: false });
    authState.isLoading = true;
    const protectedLoading = await render(wrap('/'));
    expect(document.body.textContent).toContain('Loading...');
    await protectedLoading.unmount();

    authState.isLoading = false;
    api.get.mockImplementation(() => new Promise(() => undefined));
    const setupLoading = await render(wrap('/'));
    expect(document.body.textContent).toContain('Loading...');
    await setupLoading.unmount();
  });

  it('redirects completed setups away from the setup page', async () => {
    api.get.mockResolvedValue({ needsSetup: false });
    const view = await render(wrap('/setup'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Layout shell');
      expect(document.body.textContent).toContain('Dashboard page');
    });
    await view.unmount();
  });

  it('renders the protected layout when setup and auth are valid', async () => {
    api.get.mockResolvedValue({ needsSetup: false });
    const view = await render(wrap('/'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Layout shell');
      expect(document.body.textContent).toContain('Dashboard page');
    });
    await view.unmount();
  });
});