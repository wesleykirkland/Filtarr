// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from '../../src/client/pages/Settings';
import { click, render, waitFor } from '../support/render';

const { api, toast, navigate } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  toast: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/components/Toast', () => ({ toast }));
vi.mock('../../src/client/hooks/useAuth', () => ({ useAuth: () => ({ session: { authenticated: true, mode: 'basic', user: { username: 'admin', displayName: 'Admin' } } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

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

async function setChecked(input: HTMLInputElement, checked: boolean) {
  await act(async () => {
    if (input.checked !== checked) input.click();
  });
}

describe('Settings page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    toast.mockReset();
    navigate.mockReset();
    api.get.mockReset().mockImplementation((url: string) => {
      if (url === '/settings/auth-mode') return Promise.resolve({ authMode: 'basic', hasAdminUser: false });
      if (url === '/auth/api-keys') return Promise.resolve([{ id: 1, name: 'CLI', maskedKey: 'flt_***', scopes: [], expiresAt: null, lastUsedAt: null, createdAt: '2024-01-01T00:00:00Z', revoked: false }]);
      if (url === '/settings/app') return Promise.resolve({ validationIntervalMinutes: 60 });
      if (url === '/settings/notifications') return Promise.resolve({ slackEnabled: false, slackWebhookUrl: '', slackWebhookUrlConfigured: false, webhookEnabled: false });
      if (url === '/directories') return Promise.resolve([{ id: 3, path: '/downloads', recursive: true, enabled: true, createdAt: '2024-01-01T00:00:00Z' }]);
      return Promise.resolve({});
    });
    api.post.mockReset().mockResolvedValue({ id: 1, apiKey: 'flt_new_secret' });
    api.put.mockReset().mockImplementation((url: string) => {
      if (url === '/settings/auth-mode') return Promise.resolve({ success: true, authMode: 'forms', message: 'Auth updated' });
      return Promise.resolve({ success: true, message: 'Saved' });
    });
    api.delete.mockReset().mockResolvedValue({});
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('validates and saves general and notification settings', async () => {
    const view = await render(wrap(<Settings />));
    await waitFor(() => {
      expect(document.body.querySelector('input[type="number"]')).toBeTruthy();
    });

    await setInputValue(document.body.querySelector('input[type="number"]') as HTMLInputElement, '0');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save general settings') ?? null);
    expect(toast).toHaveBeenCalledWith('error', 'Validation interval must be at least 1 minute');

    await setInputValue(document.body.querySelector('input[type="number"]') as HTMLInputElement, '15');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save general settings') ?? null);
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/app', { validationIntervalMinutes: 15 });
    });
    toast.mockClear();

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Notifications')) ?? null);
    await setChecked(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).type === 'checkbox') as HTMLInputElement, true);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save notification settings') ?? null);
    expect(toast.mock.calls).toContainEqual(['error', 'Provide a Slack webhook URL or disable Slack notifications.']);

    await setInputValue(document.body.querySelector('input[type="url"]') as HTMLInputElement, 'https://hooks.slack.test/abc');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save notification settings') ?? null);
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/notifications', { slackEnabled: true, webhookEnabled: false, slackWebhookUrl: 'https://hooks.slack.test/abc' });
    });
    await view.unmount();
  });

  it('manages watched directories and changes auth mode with credentials', async () => {
    const view = await render(wrap(<Settings />));
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Paths & Storage'))).toBeTruthy();
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Paths & Storage')) ?? null);
    const textInputs = Array.from(document.body.querySelectorAll('input')).filter((node) => (node as HTMLInputElement).type === 'text') as HTMLInputElement[];
    await setInputValue(textInputs[0]!, '/media/downloads');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Add Directory') ?? null);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/directories', { path: '/media/downloads', recursive: true });
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Edit') ?? null);
    const editInputs = Array.from(document.body.querySelectorAll('input')).filter((node) => (node as HTMLInputElement).type === 'text') as HTMLInputElement[];
    await setInputValue(editInputs[editInputs.length - 1]!, '/media/updated');
    await setChecked(Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).id === 'editRec-3') as HTMLInputElement, false);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save') ?? null);
    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/directories/3', { path: '/media/updated', recursive: false });
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Remove') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Remove directory')).toBeTruthy();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Remove directory') ?? null);
    expect(api.delete).toHaveBeenCalledWith('/directories/3');

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Authentication')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Change') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Cancel') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Change') ?? null);
    const radios = Array.from(document.body.querySelectorAll('input')).filter((node) => (node as HTMLInputElement).type === 'radio') as HTMLInputElement[];
    await setChecked(radios.find((node) => node.value === 'forms')!, true);
    const authInputs = Array.from(document.body.querySelectorAll('input')).filter((node) => (node as HTMLInputElement).type !== 'radio') as HTMLInputElement[];
    await setInputValue(authInputs.find((node) => node.placeholder?.toLowerCase().includes('username')) ?? authInputs[0]!, 'root');
    await setInputValue(authInputs.find((node) => node.type === 'password')!, 'secret123');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Save Changes') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Confirm Change')).toBeTruthy();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Confirm Change') ?? null);

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/auth-mode', { authMode: 'forms', username: 'root', password: 'secret123' });
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    });

    await view.unmount();
  });

  it('rotates API keys and copies the newly issued key', async () => {
    const view = await render(wrap(<Settings />));
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('API Keys'))).toBeTruthy();
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('API Keys')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Rotate') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Cancel') ?? null);
    expect(api.post).not.toHaveBeenCalledWith('/auth/api-keys/rotate', { keyId: 1 });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Rotate') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Confirm')).toBeTruthy();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Confirm') ?? null);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/api-keys/rotate', { keyId: 1 });
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === '📋') ?? null);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('flt_new_secret');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === "I've saved this key") ?? null);
    expect(document.body.textContent).not.toContain('Save this API key');
    await view.unmount();
  });
});