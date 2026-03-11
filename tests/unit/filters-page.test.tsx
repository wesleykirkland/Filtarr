// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Filters from '../../src/client/pages/Filters';
import { click, render, waitFor } from '../support/render';

const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  toast: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/components/Toast', () => ({ toast }));
vi.mock('../../src/client/components/FilesystemPicker', () => ({
  FilesystemPicker: ({ onSelect, onClose }: { onSelect: (path: string) => void; onClose: () => void }) => (
    <button onClick={() => { onSelect('/picked/path'); onClose(); }}>Mock select path</button>
  ),
}));

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setSelectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setChecked(input: HTMLInputElement, checked: boolean) {
  await act(async () => {
    if (input.checked !== checked) input.click();
  });
}

describe('Filters page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    toast.mockReset();
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({ id: 10 });
    api.put.mockReset().mockResolvedValue({ id: 2 });
    api.delete.mockReset().mockResolvedValue({});
  });

  it('creates a filter from a preset, supports path picking, and submits notification fields', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/filters') return Promise.resolve([]);
      if (url === '/instances') return Promise.resolve([{ id: 1, name: 'Radarr', type: 'radarr' }]);
      if (url === '/filters/presets') {
        return Promise.resolve([{ id: 'movie-quarantine', name: 'Movie quarantine', description: 'Preset', ruleType: 'extension', rulePayload: 'exe', actionType: 'move', actionPayload: '/quarantine' }]);
      }
      return Promise.resolve([]);
    });

    const view = await render(wrap(<Filters />));
    let addFirstFilterButton: Element | null = null;
    await waitFor(() => {
      addFirstFilterButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Add Your First Filter')) ?? null;
      expect(addFirstFilterButton).toBeTruthy();
    });

    await click(addFirstFilterButton);

    let moviePresetButton: Element | null = null;
    await waitFor(() => {
      moviePresetButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Movie quarantine')) ?? null;
      expect(moviePresetButton).toBeTruthy();
    });

    await click(moviePresetButton);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Browse')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Mock select path') ?? null);
    await setChecked(document.body.querySelector('#notifyOnMatch') as HTMLInputElement, true);
    await setInputValue(document.body.querySelector('#filter-webhook-url') as HTMLInputElement, 'https://hook.example');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Create Filter') ?? null);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(1);
    });

    expect(api.post).toHaveBeenCalledWith('/filters', {
      name: 'Movie quarantine',
      description: undefined,
      triggerSource: 'watcher',
      ruleType: 'extension',
      rulePayload: 'exe',
      actionType: 'move',
      actionPayload: '/quarantine',
      targetPath: '/picked/path',
      instanceId: 1,
      notifyOnMatch: true,
      notifyWebhookUrl: 'https://hook.example',
      enabled: true,
    });
    await view.unmount();
  });

  it('validates missing instances, updates an existing filter, and deletes it', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/filters') {
        return Promise.resolve([{ id: 2, name: 'Keep clean', description: 'desc', trigger_source: 'watcher', rule_type: 'extension', rule_payload: 'nfo', action_type: 'notify', action_payload: '', target_path: '/downloads', is_built_in: 0, notify_on_match: 1, notify_webhook_url: '', notify_webhook_url_configured: true, instance_id: 1, enabled: 1, sort_order: 1, created_at: '' }]);
      }
      if (url === '/instances') return Promise.resolve([{ id: 1, name: 'Sonarr', type: 'sonarr' }]);
      if (url === '/filters/presets') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const view = await render(wrap(<Filters />));
    let editButton: Element | null = null;
    await waitFor(() => {
      editButton = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Edit') ?? null;
      expect(editButton).toBeTruthy();
    });

    await click(editButton);
    await setInputValue(document.body.querySelector('#filter-name') as HTMLInputElement, 'Keep cleaner');
    await setChecked(document.body.querySelector('#notifyOnMatch') as HTMLInputElement, true);
    await setChecked(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).type === 'checkbox' && node !== document.body.querySelector('#notifyOnMatch') && node !== document.body.querySelector('#filterEnabled')) as HTMLInputElement, true);

    let updateFilterButton: Element | null = null;
    await waitFor(() => {
      updateFilterButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Update Filter') ?? null;
      expect(updateFilterButton).toBeTruthy();
    });

    await click(updateFilterButton);
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/filters/2', expect.objectContaining({ name: 'Keep cleaner', notifyWebhookUrl: '' }));
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete') ?? null);

    let confirmDeleteButton: Element | null = null;
    await waitFor(() => {
      confirmDeleteButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete filter') ?? null;
      expect(confirmDeleteButton).toBeTruthy();
    });

    await click(confirmDeleteButton);
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/filters/2');
    });
    await view.unmount();

    api.get.mockImplementation((url: string) => {
      if (url === '/filters') return Promise.resolve([]);
      if (url === '/instances') return Promise.resolve([]);
      if (url === '/filters/presets') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const validationView = await render(wrap(<Filters />));

    let validationAddButton: Element | null = null;
    await waitFor(() => {
      validationAddButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Add Your First Filter')) ?? null;
      expect(validationAddButton).toBeTruthy();
    });

    await click(validationAddButton);

    let customFilterButton: Element | null = null;
    await waitFor(() => {
      customFilterButton =
        Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Custom Filter')) ?? null;
      expect(customFilterButton).toBeTruthy();
    });

    await click(customFilterButton);
    await setInputValue(document.body.querySelector('#filter-name') as HTMLInputElement, 'Needs instance');
    await setInputValue(document.body.querySelector('#filter-rule-payload') as HTMLInputElement, 'exe');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Create Filter') ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Please select an Arr instance');
    });
    expect(api.post).not.toHaveBeenCalled();
    await validationView.unmount();
  });
});