// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Scheduler from '../../src/client/pages/Scheduler';
import { click, render, waitFor } from '../support/render';

const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  toast: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/components/Toast', () => ({ toast }));

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
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

describe('Scheduler page', () => {
  beforeEach(() => {
    toast.mockReset();
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({ id: 7 });
    api.put.mockReset().mockResolvedValue({ id: 7 });
    api.delete.mockReset().mockResolvedValue({});
  });

  it('shows empty state and creates a scheduled job from the form', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/jobs') return Promise.resolve([]);
      if (url === '/filters') return Promise.resolve([{ id: 1, name: 'Movies', description: 'desc', is_built_in: 0, target_path: '/downloads', action_type: 'move' }]);
      return Promise.resolve([]);
    });

    const view = await render(wrap(<Scheduler />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('No scheduled jobs');
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Add First Job')) ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).placeholder === 'Run: Movies')).toBeTruthy();
    });
    await setInputValue(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).placeholder === 'Run: Movies') as HTMLInputElement, 'Nightly movie run');
    await setSelectValue(Array.from(document.body.querySelectorAll('select'))[0] as HTMLSelectElement, '*/15 * * * *');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Schedule Job') ?? null);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/jobs', {
        name: 'Nightly movie run',
        description: undefined,
        schedule: '*/15 * * * *',
        type: 'filter_run',
        payload: JSON.stringify({ filterId: 1 }),
        enabled: true,
      });
    });

    await view.unmount();
  });

  it('updates and deletes an existing scheduled job', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/jobs') {
        return Promise.resolve([{ id: 7, name: 'Hourly cleanup', description: 'desc', schedule: '0 * * * *', type: 'filter_run', payload: JSON.stringify({ filterId: 1 }), enabled: true, lastRunStatus: 'success', createdAt: '' }]);
      }
      if (url === '/filters') return Promise.resolve([{ id: 1, name: 'Cleanup', description: 'desc', is_built_in: 0, target_path: '/downloads', action_type: 'delete' }]);
      return Promise.resolve([]);
    });

    const view = await render(wrap(<Scheduler />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Hourly cleanup');
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Edit') ?? null);
    await setInputValue(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).value === 'Hourly cleanup') as HTMLInputElement, 'Updated cleanup');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Update Job') ?? null);
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/jobs/7', {
        name: 'Updated cleanup',
        description: 'desc',
        schedule: '0 * * * *',
        type: 'filter_run',
        payload: JSON.stringify({ filterId: 1 }),
        enabled: true,
      });
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete job')).toBeTruthy();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete job') ?? null);
    expect(api.delete).toHaveBeenCalledWith('/jobs/7');
    await view.unmount();
  });
});