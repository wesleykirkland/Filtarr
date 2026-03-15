// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../../src/client/pages/Setup';
import { click, render, waitFor } from '../support/render';

const { api, toast, navigate } = vi.hoisted(() => ({
  api: { post: vi.fn() },
  toast: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/components/Toast', () => ({ toast }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}><Setup /></QueryClientProvider>;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Setup page branches', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    api.post.mockReset();
    toast.mockReset();
    navigate.mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('blocks mismatched and short passwords before submitting', async () => {
    const view = await render(wrap());

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Get Started')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Continue') ?? null);
    await waitFor(() => expect(document.body.querySelectorAll('input').length).toBeGreaterThanOrEqual(3));

    const inputs = Array.from(document.body.querySelectorAll('input')).slice(-3);
    await setInputValue(inputs[0]!, 'admin');
    await setInputValue(inputs[1]!, 'password123');
    await setInputValue(inputs[2]!, 'password124');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Complete Setup')) ?? null);
    expect(toast).toHaveBeenCalledWith('error', 'Passwords do not match');

    toast.mockClear();
    await setInputValue(inputs[1]!, 'short');
    await setInputValue(inputs[2]!, 'short');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Complete Setup')) ?? null);
    expect(toast).toHaveBeenCalledWith('error', 'Password must be at least 8 characters');
    expect(api.post).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('completes basic setup and continues to the dashboard', async () => {
    api.post.mockResolvedValue({ apiKey: 'flt_basic', message: 'done' });
    const view = await render(wrap());

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Get Started')) ?? null);
    await act(async () => {
      Array.from(document.body.querySelectorAll('input')).find((node) => node.value === 'basic')!.click();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Continue') ?? null);
    await waitFor(() => expect(document.body.querySelectorAll('input').length).toBeGreaterThanOrEqual(3));

    const inputs = Array.from(document.body.querySelectorAll('input')).slice(-3);
    await setInputValue(inputs[0]!, 'admin');
    await setInputValue(inputs[1]!, 'password123');
    await setInputValue(inputs[2]!, 'password123');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Complete Setup')) ?? null);
    await waitFor(() => expect(document.body.textContent).toContain('Continue to Dashboard'));
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Continue to Dashboard')) ?? null);

    expect(api.post).toHaveBeenCalledWith('/setup/complete', { authMode: 'basic', username: 'admin', password: 'password123' });
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    await view.unmount();
  });

  it('continues forms setup to the login page after copying the generated API key', async () => {
    api.post.mockResolvedValue({ apiKey: 'flt_forms', message: 'done' });
    const view = await render(wrap());

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Get Started')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Continue') ?? null);
    await waitFor(() => expect(document.body.querySelectorAll('input').length).toBeGreaterThanOrEqual(3));

    const inputs = Array.from(document.body.querySelectorAll('input')).slice(-3);
    await setInputValue(inputs[0]!, 'admin');
    await setInputValue(inputs[1]!, 'password123');
    await setInputValue(inputs[2]!, 'password123');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Complete Setup')) ?? null);
    await waitFor(() => expect(document.body.querySelector('[aria-label="Copy API key"]')).toBeTruthy());
    await click(document.body.querySelector('[aria-label="Copy API key"]'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('flt_forms');

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Continue to Login')) ?? null);
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    await view.unmount();
  });
});
