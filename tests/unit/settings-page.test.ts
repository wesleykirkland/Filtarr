// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/client/lib/api';
import Settings from '../../src/client/pages/Settings.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

vi.mock('../../src/client/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../src/client/hooks/useAuth', () => ({
  useAuth: () => ({
    session: {
      authenticated: true,
      mode: 'forms',
      user: { id: 1, username: 'admin', displayName: 'Admin' },
    },
  }),
}));

const mockGet = vi.mocked(api.get);

function LocationDisplay() {
  const location = useLocation();
  return React.createElement('div', { 'data-testid': 'location' }, location.pathname);
}

async function renderSettings(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    root?.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          MemoryRouter,
          { initialEntries: [initialPath] },
          React.createElement(
            React.Fragment,
            null,
            React.createElement(LocationDisplay),
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: '/settings/*',
                element: React.createElement(Settings),
              }),
            ),
          ),
        ),
      ),
    );
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean) {
  for (let index = 0; index < 20; index += 1) {
    if (check()) return;
    await flush();
  }

  throw new Error('Timed out waiting for UI update');
}

describe('Settings subpages', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockGet.mockReset();
    mockGet.mockImplementation((path: string) => {
      if (path === '/settings/auth-mode') {
        return Promise.resolve({
          authMode: 'forms',
          hasAdminUser: true,
          oidc: {
            issuerUrl: 'https://issuer.example.com/realms/filtarr',
            clientId: 'filtarr-web',
            clientSecret: 'stored-secret',
            callbackUrl: 'http://localhost:9898/api/v1/auth/oidc/callback',
            scopes: ['openid', 'profile', 'email'],
          },
        } as never);
      }

      if (path === '/auth/api-keys') return Promise.resolve([] as never);
      if (path === '/settings/app') {
        return Promise.resolve({ validationIntervalMinutes: 60 } as never);
      }
      if (path === '/settings/notifications') {
        return Promise.resolve({
          slackEnabled: false,
          webhookEnabled: true,
          defaultWebhookUrl: '',
          defaultSlackToken: '',
          defaultSlackChannel: '',
        } as never);
      }

      if (path === '/settings/backup') {
        return Promise.resolve({
          enabled: true,
          directory: '/config/backup',
          retentionCount: 30,
          frequency: 'daily',
          lastBackupAt: '2026-03-07T12:00:00.000Z',
          nextBackupAt: '2026-03-08T12:00:00.000Z',
          lastError: null,
          backups: [
            {
              fileName: 'filtarr-settings-20260307-120000.sql',
              filePath: '/config/backup/filtarr-settings-20260307-120000.sql',
              sizeBytes: 2048,
              createdAt: '2026-03-07T12:00:00.000Z',
            },
          ],
          redactionNotes: ['settings.default_slack_token => blank'],
        } as never);
      }

      throw new Error(`Unhandled GET ${path}`);
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('redirects /settings to the general subpage and shows the subpage navigation', async () => {
    await renderSettings('/settings');

    await waitFor(
      () => document.querySelector('[data-testid="location"]')?.textContent === '/settings/general',
    );

    expect(document.body.textContent).toContain('General');
    expect(document.body.textContent).toContain('Notifications');
    expect(document.body.textContent).toContain('Authentication');
    expect(document.body.textContent).toContain('API Keys');
    expect(document.body.textContent).toContain('Backup & Restore');
    expect(document.body.textContent).toContain('General configuration');
  });

  it('supports direct-linking to the authentication subpage and shows OIDC as unavailable', async () => {
    await renderSettings('/settings/authentication');

    await waitFor(() => document.body.textContent?.includes('Authentication') ?? false);

    await act(async () => {
      const changeButton = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Change',
      ) as HTMLButtonElement;
      changeButton.click();
    });

    await waitFor(() => document.body.textContent?.includes('OIDC / OpenID Connect') ?? false);

    const oidcRadio = document.querySelector(
      'input[name="authMode"][value="oidc"]',
    ) as HTMLInputElement;
    expect(oidcRadio.disabled).toBe(true);

    await act(async () => {
      oidcRadio.click();
    });

    expect(oidcRadio.checked).toBe(false);
    expect(document.body.textContent).toContain(
      'External identity provider sign-in via OpenID Connect',
    );
    expect(document.body.textContent).toContain('not yet available in this build');
    expect(
      document.querySelector('input[placeholder="https://id.example.com/realms/filtarr"]'),
    ).toBeNull();
  });

  it('supports direct-linking to the backup subpage and shows backup actions', async () => {
    await renderSettings('/settings/backup');

    await waitFor(() => document.body.textContent?.includes('Backup & Restore') ?? false);
    await waitFor(
      () =>
        (document.querySelector('input[placeholder="/config/backup"]') as HTMLInputElement | null)
          ?.value === '/config/backup',
    );
    await waitFor(
      () => document.body.textContent?.includes('filtarr-settings-20260307-120000.sql') ?? false,
    );

    expect(document.body.textContent).toContain('Enable automated daily backups');
    expect(document.body.textContent).toContain('Create Backup Now');
    expect(document.body.textContent).toContain('Import Backup');
    expect(
      (document.querySelector('input[placeholder="/config/backup"]') as HTMLInputElement).value,
    ).toBe('/config/backup');
    expect(document.body.textContent).toContain('filtarr-settings-20260307-120000.sql');
  });

  it('clears a stored notification secret by sending null', async () => {
    const baseGet = mockGet.getMockImplementation() as (path: string) => Promise<unknown>;
    mockGet.mockImplementation((path: string) => {
      if (path === '/settings/notifications') {
        return Promise.resolve({
          slackEnabled: false,
          webhookEnabled: true,
          defaultWebhookUrl: '••••abcd',
          hasDefaultWebhookUrl: true,
          defaultSlackToken: '',
          hasDefaultSlackToken: false,
          defaultSlackChannel: '',
        } as never);
      }
      return baseGet(path);
    });
    const mockPut = vi.mocked(api.put);
    mockPut.mockReset();
    mockPut.mockResolvedValue({ success: true, message: 'Saved' } as never);

    await renderSettings('/settings/notifications');
    const findButton = (label: string) =>
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
    await waitFor(() => Boolean(findButton('Clear stored URL')));

    await act(async () => {
      findButton('Clear stored URL')?.click();
    });
    expect(
      (document.getElementById('settings-default-webhook-url') as HTMLInputElement).placeholder,
    ).toBe('Will be cleared on save');

    await act(async () => {
      findButton('Save Notification Settings')?.click();
    });

    expect(mockPut).toHaveBeenCalledWith(
      '/settings/notifications',
      expect.objectContaining({ defaultWebhookUrl: null, defaultSlackToken: undefined }),
    );
  });
});
