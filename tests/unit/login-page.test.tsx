// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../../src/client/pages/Login';
import { click, render, waitFor } from '../support/render';

const state = vi.hoisted(() => ({
  auth: { login: vi.fn(), session: { authenticated: false, mode: 'forms' }, isLoading: false },
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../src/client/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('../../src/client/components/Toast', () => ({ toast: state.toast }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Login page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    state.auth.login.mockReset();
    state.navigate.mockReset();
    state.toast.mockReset();
    state.auth.isLoading = false;
    state.auth.session = { authenticated: false, mode: 'forms' };
  });

  it('redirects authenticated users away from the login screen', async () => {
    state.auth.session = { authenticated: true, mode: 'forms' };

    const view = await render(<Login />);

    expect(state.navigate).toHaveBeenCalledWith('/', { replace: true });
    await view.unmount();
  });

  it('renders the basic auth helper and exposes the refresh action', async () => {
    state.auth.session = { authenticated: false, mode: 'basic' };

    const view = await render(<Login />);

    expect(document.body.textContent).toContain('Basic Authentication');
    expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Refresh Page')).toBeTruthy();

    await view.unmount();
  });

  it('shows a toast and resets submit state when login fails', async () => {
    state.auth.login.mockRejectedValueOnce(new Error('Bad credentials'));

    const view = await render(<Login />);
    const inputs = Array.from(document.body.querySelectorAll('input')) as HTMLInputElement[];
    await setInputValue(inputs[0]!, 'admin');
    await setInputValue(inputs[1]!, 'wrong-password');

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Sign In') ?? null);

    await waitFor(() => {
      expect(state.auth.login).toHaveBeenCalledWith('admin', 'wrong-password');
      expect(state.toast).toHaveBeenCalledWith('error', 'Bad credentials');
      expect(document.body.textContent).toContain('Sign In');
    });

    await view.unmount();
  });
});