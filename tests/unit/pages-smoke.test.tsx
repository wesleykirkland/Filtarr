// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '../../src/client/pages/Activity';
import Dashboard from '../../src/client/pages/Dashboard';
import Login from '../../src/client/pages/Login';
import Setup from '../../src/client/pages/Setup';
import { click, render, waitFor } from '../support/render';

const { api, login } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  login: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/hooks/useAuth', () => ({ useAuth: () => ({ login, isLoading: false, session: { authenticated: false, mode: 'forms' } }) }));
vi.mock('../../src/client/hooks/useInstances', () => ({ useInstances: () => ({ data: [{ id: 1, name: 'Main', type: 'sonarr', enabled: 1, url: 'https://sonarr.example.com' }] }) }));

function wrap(node: React.ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>{node}</QueryClientProvider></MemoryRouter>;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('client page smoke coverage', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    login.mockClear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('renders the dashboard summary and readiness cards', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/health') return Promise.resolve({ status: 'ok', version: '1.2.3' });
      if (url === '/filters') return Promise.resolve([{ enabled: 1, target_path: '/downloads' }]);
      return Promise.resolve([{ enabled: true }]);
    });

    const view = await render(wrap(<Dashboard />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Dashboard');
      expect(document.body.textContent).toContain('What to do next');
      expect(document.body.textContent).toContain('Main');
    });
    await view.unmount();
  });

  it('renders and filters the activity timeline', async () => {
    api.get.mockResolvedValue([
      { id: 1, type: 'validation', source: 'instances', message: 'Validation failed', details: { status: 'failure' }, createdAt: '2024-01-01T00:00:00Z' },
      { id: 2, type: 'matched', source: 'filters', message: 'Rule matched', details: { success: true }, createdAt: '2024-01-02T00:00:00Z' },
    ]);

    const view = await render(wrap(<Activity />));
    await waitFor(() => {
      expect(document.body.querySelectorAll('select').length).toBeGreaterThanOrEqual(2);
    });
    const selects = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[];
    act(() => {
      selects[0]!.value = 'validation';
      selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
      selects[1]!.value = 'instances';
      selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Reset filters') ?? null);

    await waitFor(() => {
      expect(document.body.textContent).toContain('Activity');
      expect(document.body.textContent).toContain('Validation failed');
    });
    await view.unmount();
  });

  it('submits login credentials and setup completion flows', async () => {
    api.post.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ apiKey: 'flt_secret', authMode: 'none' }).mockResolvedValueOnce({ success: true, authMode: 'forms' });

    const loginView = await render(wrap(<Login />, '/login'));
    await waitFor(() => {
      expect(document.body.querySelectorAll('input').length).toBeGreaterThanOrEqual(2);
    });
    const loginInputs = Array.from(document.body.querySelectorAll('input')) as HTMLInputElement[];
    await setInputValue(loginInputs[0]!, 'admin');
    await setInputValue(loginInputs[1]!, 'password123');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Sign In')) ?? null);
    expect(login).toHaveBeenCalledWith('admin', 'password123');
    await loginView.unmount();

    const noneView = await render(wrap(<Setup />, '/setup'));
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Get Started')) ?? null);
    const noneRadio = Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).value === 'none') as HTMLInputElement;
    act(() => noneRadio.click());
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Continue') ?? null);
    await waitFor(() => {
      expect(document.body.querySelector('[aria-label="Copy API key"]')).toBeTruthy();
    });
    await click(document.body.querySelector('[aria-label="Copy API key"]'));
    expect(api.post).toHaveBeenCalledWith('/setup/complete', { authMode: 'none', username: 'admin', password: 'unused' });
    await noneView.unmount();

    const formsView = await render(wrap(<Setup />, '/setup'));
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Get Started')) ?? null);
    const radio = Array.from(document.body.querySelectorAll('input')).find((node) => (node as HTMLInputElement).value === 'forms') as HTMLInputElement;
    act(() => radio.click());
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Continue') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('input')).length).toBeGreaterThanOrEqual(3);
    });
    const formInputs = Array.from(document.body.querySelectorAll('input')).slice(-3) as HTMLInputElement[];
    await setInputValue(formInputs[0]!, 'admin');
    await setInputValue(formInputs[1]!, 'password123');
    await setInputValue(formInputs[2]!, 'password123');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Complete Setup')) ?? null);
    expect(api.post).toHaveBeenCalledWith('/setup/complete', { authMode: 'forms', username: 'admin', password: 'password123' });
    await formsView.unmount();
  });
});
