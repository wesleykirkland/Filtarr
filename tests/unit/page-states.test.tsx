// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '../../src/client/pages/Activity';
import Dashboard from '../../src/client/pages/Dashboard';
import Settings from '../../src/client/pages/Settings';
import SettingsNotificationsPage from '../../src/client/pages/settings/SettingsNotificationsPage';
import { render, waitFor } from '../support/render';

const { api, useInstances } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  useInstances: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/hooks/useInstances', () => ({ useInstances }));
vi.mock('../../src/client/hooks/useAuth', () => ({
  useAuth: () => ({
    session: { authenticated: true, mode: 'forms', user: { username: 'admin' } },
    logout: vi.fn(),
  }),
}));

function createWrapper(node: React.ReactNode, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryOnMount: false },
        mutations: { retry: false },
      },
    });

  return {
    queryClient,
    ui: (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </MemoryRouter>
    ),
  };
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function mockSettingsQueries() {
  api.get.mockImplementation((url: string) => {
    if (url === '/settings/auth-mode') return Promise.resolve({ authMode: 'forms', hasAdminUser: true });
    if (url === '/auth/api-keys') return Promise.resolve([]);
    if (url === '/settings/app') return Promise.resolve({ validationIntervalMinutes: 60 });
    if (url === '/settings/notifications') {
      return Promise.resolve({
        slackEnabled: false,
        webhookEnabled: true,
        defaultWebhookUrl: '',
        defaultSlackToken: '',
        defaultSlackChannel: '',
      });
    }
    if (url === '/directories') return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

describe('page loading and error states', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
    useInstances.mockReset();
  });

  it('shows a dashboard error state instead of misleading next steps when summary data fails', async () => {
    useInstances.mockReturnValue({ data: [], isLoading: false, error: new Error('Instances unavailable') });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['health'], { status: 'ok', version: '1.2.3' });
    queryClient.setQueryData(['filters'], []);
    queryClient.setQueryData(['jobs'], []);
    api.get.mockImplementation((url: string) => {
      if (url === '/health') return Promise.resolve({ status: 'ok', version: '1.2.3' });
      if (url === '/filters') return Promise.resolve([]);
      if (url === '/jobs') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { ui } = createWrapper(<Dashboard />, queryClient);
    const view = await render(ui);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Unable to load dashboard data');
      expect(document.body.textContent).not.toContain('What to do next');
    });
    await view.unmount();
  });

  it('shows an activity error state instead of an empty timeline when loading fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryOnMount: false },
        mutations: { retry: false },
      },
    });
    await queryClient
      .prefetchQuery({
        queryKey: ['events', 'timeline'],
        queryFn: () => Promise.reject(new Error('Timeline offline')),
        retry: false,
      })
      .catch(() => null);

    const { ui } = createWrapper(<Activity />, queryClient);
    const view = await render(ui);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Unable to load activity');
      expect(document.body.textContent).toContain('Timeline offline');
    });
    await view.unmount();
  });
});

describe('settings form state', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
    useInstances.mockReset();
    mockSettingsQueries();
  });

  it('preserves unsaved general settings when the query cache refetches', async () => {
    const { queryClient, ui } = createWrapper(<Settings />);
    const view = await render(ui);
    await waitFor(() => {
      expect(document.body.querySelector('input[type="number"]')).toBeTruthy();
    });

    const input = document.body.querySelector('input[type="number"]') as HTMLInputElement;
    await setInputValue(input, '15');

    act(() => {
      queryClient.setQueryData(['settings', 'app'], { validationIntervalMinutes: 60 });
    });
    await waitFor(() => {
      expect(input.value).toBe('15');
    });
    await view.unmount();
  });

  it('preserves unsaved notification edits when the query cache refetches', async () => {
    const { queryClient, ui } = createWrapper(<SettingsNotificationsPage />);
    const view = await render(ui);

    await waitFor(() => {
      expect(document.body.querySelector('input[type="url"]')).toBeTruthy();
    });

    const urlInput = document.body.querySelector('input[type="url"]') as HTMLInputElement;
    await setInputValue(urlInput, 'https://discord.com/api/webhooks/NEW');

    act(() => {
      queryClient.setQueryData(['settings', 'notifications'], {
        slackEnabled: false,
        webhookEnabled: true,
        defaultWebhookUrl: '',
        defaultSlackToken: '',
        defaultSlackChannel: '',
      });
    });
    await waitFor(() => {
      expect(urlInput.value).toBe('https://discord.com/api/webhooks/NEW');
    });
    await view.unmount();
  });
});