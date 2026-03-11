// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/client/hooks/useAuth';
import {
  useCreateInstance,
  useDeleteInstance,
  useInstances,
  useTestInstance,
  useTestUnsavedInstance,
  useUpdateInstance,
} from '../../src/client/hooks/useInstances';
import { click, render, waitFor } from '../support/render';

const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  toast: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/components/Toast', () => ({ toast }));

function wrap(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function AuthHarness() {
  const { session, login, logout, retrySession } = useAuth();
  return (
    <div>
      <div data-session={session?.user?.displayName ?? session?.mode ?? 'none'} />
      <button onClick={() => login('admin', 'secret')}>login</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => retrySession()}>retry</button>
    </div>
  );
}

function InstancesHarness() {
  const { data = [] } = useInstances();
  const create = useCreateInstance();
  const update = useUpdateInstance();
  const remove = useDeleteInstance();
  const testSaved = useTestInstance();
  const testUnsaved = useTestUnsavedInstance();

  return (
    <div>
      <div data-count={String(data.length)} />
      <button onClick={() => create.mutate({ name: 'A', type: 'sonarr', url: 'https://a', apiKey: 'k' })}>create</button>
      <button onClick={() => update.mutate({ id: 1, name: 'B' })}>update</button>
      <button onClick={() => remove.mutate(1)}>delete</button>
      <button onClick={() => testSaved.mutate(1)}>test-saved</button>
      <button onClick={() => testUnsaved.mutate({ name: 'A', type: 'sonarr', url: 'https://a', apiKey: 'k' })}>test-unsaved</button>
    </div>
  );
}

describe('client hooks', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
    api.delete.mockReset();
    toast.mockClear();
  });

  it('loads auth state and exposes login/logout/retry helpers', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/auth/session') {
        return Promise.resolve({ authenticated: true, mode: 'forms', user: { id: 1, username: 'admin', displayName: 'Admin' } });
      }
      return Promise.resolve(undefined);
    });
    api.post.mockResolvedValue({ success: true });

    const view = await render(wrap(<AuthProvider><AuthHarness /></AuthProvider>));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/auth/session');
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'login') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'logout') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'retry') ?? null);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'secret' });
      expect(api.post).toHaveBeenCalledWith('/auth/logout');
    });

    window.dispatchEvent(new Event('auth:401'));
    await view.unmount();
  });

  it('queries instances and drives create/update/delete/test mutations', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/instances') {
        return Promise.resolve([{ id: 1, name: 'Main', type: 'sonarr', url: 'https://a', api_key_masked: '***', timeout: 30, enabled: 1, skipSslVerify: false, created_at: 'now', updated_at: 'now' }]);
      }
      return Promise.resolve({ success: true, version: '4.0.0' });
    });
    api.post.mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ success: false, error: 'Denied' });
    api.put.mockResolvedValue({ id: 1 });
    api.delete.mockResolvedValue({ success: true });

    const view = await render(wrap(<InstancesHarness />));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/instances');
    });

    for (const label of ['create', 'update', 'delete', 'test-saved', 'test-unsaved']) {
      await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === label) ?? null);
    }

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/instances', expect.objectContaining({ name: 'A' }));
      expect(api.put).toHaveBeenCalledWith('/instances/1', { name: 'B' });
      expect(api.delete).toHaveBeenCalledWith('/instances/1');
      expect(api.get).toHaveBeenCalledWith('/instances/1/test');
      expect(api.post).toHaveBeenCalledWith('/instances/test', expect.objectContaining({ type: 'sonarr' }));
      expect(toast).toHaveBeenCalledWith('success', 'Instance created');
      expect(toast).toHaveBeenCalledWith('success', 'Instance updated');
      expect(toast).toHaveBeenCalledWith('success', 'Instance deleted');
      expect(toast).toHaveBeenCalledWith('success', 'Connection OK (v4.0.0)');
    });

    await view.unmount();
  });
});