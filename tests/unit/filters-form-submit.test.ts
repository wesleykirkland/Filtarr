// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ToastModule from '../../src/client/components/Toast';
import { api } from '../../src/client/lib/api';
import Filters from '../../src/client/pages/Filters.tsx';

vi.mock('../../src/client/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../src/client/components/FilesystemPicker', () => ({
  FilesystemPicker: () => null,
}));

vi.mock('../../src/client/contexts/ThemeContext.tsx', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ darkMode: true, toggleDarkMode: vi.fn() }),
}));

const mockGet = vi.mocked(api.get);
const mockPost = vi.mocked(api.post);
const mockPut = vi.mocked(api.put);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((el) =>
    el.textContent?.trim().includes(label),
  );
  if (!button) throw new Error(`Unable to find button: ${label}`);
  return button;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

async function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function submitForm() {
  const form = document.querySelector('form');
  if (!form) throw new Error('Missing form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

const existingFilter = {
  id: 9,
  name: 'Existing',
  description: 'old description',
  trigger_source: 'watcher',
  rule_type: 'extension',
  rule_payload: 'exe',
  action_type: 'move',
  action_payload: '/mnt/quarantine',
  script_runtime: 'shell',
  target_path: '/downloads',
  is_built_in: 0,
  notify_on_match: 0,
  notify_slack: 0,
  override_notifications: 0,
  instance_id: 1,
  enabled: 1,
  sort_order: 0,
  created_at: '2026-03-08T00:00:00.000Z',
};

describe('FilterForm submission', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockGet.mockReset();
    mockPost.mockReset();
    mockPut.mockReset();
    mockPost.mockResolvedValue({} as never);
    mockPut.mockResolvedValue({} as never);
    vi.spyOn(ToastModule, 'toast').mockImplementation(() => {});

    mockGet.mockImplementation((path: string) => {
      if (path === '/filters') return Promise.resolve([existingFilter] as never);
      if (path === '/filters/presets') return Promise.resolve([] as never);
      if (path === '/instances') return Promise.resolve([{ id: 1, name: 'Sonarr', type: 'sonarr' }] as never);
      if (path === '/settings/notifications') {
        return Promise.resolve({ slackEnabled: false, webhookEnabled: false } as never);
      }
      throw new Error(`Unhandled GET ${path}`);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Filters)),
      );
    });
    await waitFor(() => document.body.textContent?.includes('Existing') ?? false);
  }

  async function openNewCustomFilter() {
    await act(async () => {
      getButton('Add Filter').click();
    });
    await waitFor(() => document.body.textContent?.includes('Custom Filter') ?? false);
    await act(async () => {
      getButton('Custom Filter').click();
    });
    await waitFor(() => document.getElementById('filter-name') !== null);
    await setValue(byId('filter-name'), 'Block EXE');
    await setValue(byId('filter-watched-directory'), '/downloads');
    const ruleInput = document.querySelector<HTMLInputElement>('input[placeholder="e.g. exe,bat,sh"]');
    if (!ruleInput) throw new Error('Missing rule payload input');
    await setValue(ruleInput, 'exe');
  }

  it('submits an explicit blocklist_and_search when Arr Behavior is untouched', async () => {
    await renderPage();
    await openNewCustomFilter();

    await setValue(byId('filter-action-type'), 'delete');
    await setValue(byId('filter-action-type'), 'blocklist');
    expect(byId<HTMLSelectElement>('filter-arr-behavior').value).toBe('blocklist_and_search');

    await submitForm();
    await waitFor(() => mockPost.mock.calls.length === 1);

    expect(mockPost).toHaveBeenCalledWith(
      '/filters',
      expect.objectContaining({ actionType: 'blocklist', actionPayload: 'blocklist_and_search' }),
    );
  });

  it('keeps a move destination when flipping between move and script', async () => {
    await renderPage();
    await openNewCustomFilter();

    await setValue(byId('filter-action-type'), 'move');
    const dest = document.querySelector<HTMLInputElement>('input[placeholder="/mnt/quarantine"]');
    if (!dest) throw new Error('Missing destination input');
    await setValue(dest, '/mnt/quarantine');
    await setValue(byId('filter-action-type'), 'script');
    await setValue(byId('filter-action-type'), 'move');

    await submitForm();
    await waitFor(() => mockPost.mock.calls.length === 1);
    expect(mockPost).toHaveBeenCalledWith(
      '/filters',
      expect.objectContaining({ actionType: 'move', actionPayload: '/mnt/quarantine' }),
    );
  });

  it('sends empty strings so an edit clears description and a stale action payload', async () => {
    await renderPage();
    await act(async () => {
      getButton('Edit').click();
    });
    await waitFor(() => document.getElementById('filter-description') !== null);

    await setValue(byId('filter-description'), '');
    await setValue(byId('filter-action-type'), 'delete');

    await submitForm();
    await waitFor(() => mockPut.mock.calls.length === 1);
    expect(mockPut).toHaveBeenCalledWith(
      '/filters/9',
      expect.objectContaining({ description: '', actionType: 'delete', actionPayload: '' }),
    );
  });

  it('shows configured secrets as placeholders and only sends newly typed values', async () => {
    const withSecrets = {
      ...existingFilter,
      override_notifications: 1,
      notify_on_match: 1,
      notify_webhook_url: '••••••••wxyz',
      notify_slack: 1,
      notify_slack_token: '••••••••abcd',
      notify_slack_channel: '#alerts',
      hasNotifyWebhookUrl: true,
      hasNotifySlackToken: true,
    };
    const baseGet = mockGet.getMockImplementation();
    if (!baseGet) throw new Error('Missing base GET mock');
    mockGet.mockImplementation((path: string) =>
      path === '/filters' ? Promise.resolve([withSecrets] as never) : baseGet(path),
    );

    await renderPage();
    await act(async () => {
      getButton('Edit').click();
    });
    await waitFor(() => document.getElementById('filter-webhook-url') !== null);

    const webhookInput = byId<HTMLInputElement>('filter-webhook-url');
    const tokenInput = byId<HTMLInputElement>('filter-slack-bot-token');
    expect(webhookInput.value).toBe('');
    expect(webhookInput.placeholder).toContain('Configured (••••••••wxyz)');
    expect(webhookInput.required).toBe(false);
    expect(tokenInput.value).toBe('');
    expect(tokenInput.placeholder).toContain('Configured (••••••••abcd)');

    await submitForm();
    await waitFor(() => mockPut.mock.calls.length === 1);
    const sent = mockPut.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.notifyWebhookUrl).toBeUndefined();
    expect(sent.notifySlackToken).toBeUndefined();
    expect(sent.notifySlackChannel).toBe('#alerts');

    await waitFor(() => document.getElementById('filter-slack-bot-token') === null);
    await act(async () => {
      getButton('Edit').click();
    });
    await waitFor(() => document.getElementById('filter-slack-bot-token') !== null);
    await setValue(byId<HTMLInputElement>('filter-slack-bot-token'), 'xoxb-new-token');
    await submitForm();
    await waitFor(() => mockPut.mock.calls.length === 2);
    expect(mockPut.mock.calls[1]?.[1]).toMatchObject({ notifySlackToken: 'xoxb-new-token' });
  });
});
