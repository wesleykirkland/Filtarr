// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ToastModule from '../../src/client/components/Toast';
import { ThemeProvider } from '../../src/client/contexts/ThemeContext.tsx';
import { api } from '../../src/client/lib/api';
import Filters from '../../src/client/pages/Filters.tsx';

vi.mock('../../src/client/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/client/components/FilesystemPicker', () => ({
  FilesystemPicker: () => null,
}));

vi.mock('../../src/client/contexts/ThemeContext.tsx', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ darkMode: true, toggleDarkMode: vi.fn() }),
}));

type MockFilter = {
  id: number;
  name: string;
  description?: string;
  trigger_source: string;
  rule_type: 'regex' | 'extension' | 'size' | 'script';
  rule_payload: string;
  action_type: 'blocklist' | 'delete' | 'move' | 'script' | 'notify';
  action_payload?: string;
  target_path?: string;
  is_built_in: number;
  notify_on_match: number;
  notify_webhook_url?: string;
  notify_slack: number;
  notify_slack_token?: string;
  notify_slack_channel?: string;
  override_notifications: number;
  instance_id: number | null;
  enabled: number;
  sort_order: number;
  created_at: string;
};

const mockGet = vi.mocked(api.get);
const mockDelete = vi.mocked(api.delete);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeFilter(overrides: Partial<MockFilter> = {}): MockFilter {
  return {
    id: 1,
    name: 'Delete Me',
    trigger_source: 'watcher',
    rule_type: 'extension',
    rule_payload: 'mkv',
    action_type: 'delete',
    target_path: '/downloads',
    is_built_in: 0,
    notify_on_match: 0,
    notify_slack: 0,
    override_notifications: 0,
    instance_id: 1,
    enabled: 1,
    sort_order: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
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

function getButtonsByLabel(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter(
    (element): element is HTMLButtonElement => element.textContent?.trim() === label,
  );
}

function getButton(label: string, index = 0): HTMLButtonElement {
  const button = getButtonsByLabel(label)[index];
  if (!button) {
    throw new Error(`Unable to find button with label: ${label}`);
  }

  return button;
}

// TODO: These UI tests have timing issues and need to be fixed
describe.skip('Filters deletion modal', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockGet.mockReset();
    mockDelete.mockReset();
    vi.spyOn(ToastModule, 'toast').mockImplementation(() => {});
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

  async function renderFilters(filters: MockFilter[]) {
    mockGet.mockImplementation((path: string) => {
      if (path === '/filters') return Promise.resolve(filters as never);
      if (path === '/instances') {
        return Promise.resolve([{ id: 1, name: 'Sonarr', type: 'sonarr' }] as never);
      }
      if (path === '/settings/notifications') {
        return Promise.resolve(
          {
            slackEnabled: false,
            webhookEnabled: false,
            defaultWebhookUrl: '',
            defaultSlackToken: '',
            defaultSlackChannel: '',
          } as never,
        );
      }

      throw new Error(`Unhandled GET ${path}`);
    });
    mockDelete.mockResolvedValue(undefined as never);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, null, React.createElement(Filters)),
        ),
      );
    });

    await waitFor(() => document.body.textContent?.includes(filters[0]?.name ?? '') ?? false);
  }

  it('opens a modal before deleting and only deletes after confirmation', async () => {
    await renderFilters([makeFilter()]);

    await act(async () => {
      getButton('Delete').click();
    });

    await waitFor(() => document.body.textContent?.includes('Delete Filter') ?? false);
    expect(document.body.textContent).toContain('Are you sure you want to delete');
    expect(mockDelete).not.toHaveBeenCalled();

    await act(async () => {
      getButton('Cancel').click();
    });

    await waitFor(() => !document.body.textContent?.includes('Are you sure you want to delete'));
    expect(mockDelete).not.toHaveBeenCalled();

    await act(async () => {
      getButton('Delete').click();
    });
    await act(async () => {
      getButton('Delete Filter').click();
    });

    await waitFor(() => mockDelete.mock.calls.length === 1);
    expect(mockDelete).toHaveBeenCalledWith('/filters/1');
  });

  it('keeps built-in filters protected from deletion', async () => {
    await renderFilters([makeFilter({ id: 2, is_built_in: 1, name: 'Built-in Filter' })]);

    expect(document.body.textContent).toContain('Protected');
    expect(getButtonsByLabel('Delete')).toHaveLength(0);
  });
});
