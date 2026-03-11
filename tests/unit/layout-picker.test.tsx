// @vitest-environment jsdom
import React, { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesystemPicker } from '../../src/client/components/FilesystemPicker';
import Layout from '../../src/client/components/Layout';
import { click, render, waitFor } from '../support/render';

const { authState, themeState, api } = vi.hoisted(() => ({
  authState: {
    session: { authenticated: true, mode: 'forms', user: { username: 'admin', displayName: 'Admin' } },
    logout: vi.fn(),
  },
  themeState: { darkMode: false, toggleDarkMode: vi.fn() },
  api: { get: vi.fn() },
}));

vi.mock('../../src/client/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../src/client/lib/api', () => ({ api }));
vi.mock('../../src/client/contexts/ThemeContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/contexts/ThemeContext')>();
  return { ...actual, useTheme: () => themeState };
});

function wrap(node: React.ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>{node}</QueryClientProvider></MemoryRouter>;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('layout and filesystem picker', () => {
  beforeEach(() => {
    authState.logout.mockClear();
    themeState.toggleDarkMode.mockClear();
    api.get.mockReset();
  });

  it('renders navigation, toggles the sidebar, theme, and logout controls', async () => {
    const view = await render(wrap(<Layout><div>Child content</div></Layout>, '/settings'));

    expect(document.body.textContent).toContain('Filtarr');
    expect(document.body.textContent).toContain('Settings');
    expect(document.body.textContent).toContain('Admin');

    await click(document.body.querySelector('[aria-label="Open navigation"]'));
    await click(document.body.querySelector('[aria-label="Close navigation"]'));
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Dark mode')) ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Logout') ?? null);

    expect(themeState.toggleDarkMode).toHaveBeenCalledTimes(1);
    expect(authState.logout).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('browses directories, handles errors, and confirms selected paths', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('%2Fmovies')) {
        return Promise.resolve({ current: '/movies', parent: '/', entries: [{ name: 'kids', path: '/movies/kids', isDir: true }] });
      }
      if (url.includes('%2Fbroken')) {
        return Promise.reject(new Error('Cannot read directory'));
      }
      return Promise.resolve({ current: '/', parent: null, entries: [{ name: 'movies', path: '/movies', isDir: true }] });
    });

    const onSelect = vi.fn();
    const onClose = vi.fn();
    const view = await render(wrap(<FilesystemPicker value="/" onSelect={onSelect} onClose={onClose} />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('movies');
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('movies')) ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain('kids');
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Select Path') ?? null);

    expect(onSelect).toHaveBeenCalledWith('/movies');
    expect(onClose).toHaveBeenCalled();
    await view.unmount();

    const errorView = await render(wrap(<FilesystemPicker value="/broken" onSelect={vi.fn()} onClose={vi.fn()} />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Cannot read directory');
    });
    await errorView.unmount();
  });

  it('supports breadcrumb, parent, empty directory, and manual path navigation', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('%2Fmanual')) {
        return Promise.resolve({ current: '/manual', parent: '/', entries: [] });
      }
      if (url.includes('%2Fmovies')) {
        return Promise.resolve({ current: '/movies', parent: '/', entries: [] });
      }
      return Promise.resolve({ current: '/', parent: null, entries: [{ name: 'movies', path: '/movies', isDir: true }] });
    });

    const view = await render(wrap(<FilesystemPicker value="/movies" onSelect={vi.fn()} onClose={vi.fn()} />));
    await waitFor(() => {
      expect(document.body.textContent).toContain('No subdirectories here');
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'movies') ?? null);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/system/browse?path=%2Fmovies');
      expect(document.body.textContent).toContain('No subdirectories here');
    });

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('..')) ?? null);
    await waitFor(() => {
      expect(document.body.textContent).toContain('movies');
    });

    await setInputValue(document.body.querySelector('#selected-path') as HTMLInputElement, '/manual');
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/system/browse?path=%2Fmanual');
      expect(document.body.textContent).toContain('No subdirectories here');
    });

    await view.unmount();
  });
});