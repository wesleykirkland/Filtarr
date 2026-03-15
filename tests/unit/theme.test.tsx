// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from '../../src/client/contexts/ThemeContext';
import { click, render } from '../support/render';

function installLocalStorageMock() {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

function ThemeConsumer() {
  const { darkMode, toggleDarkMode } = useTheme();
  return (
    <button type="button" onClick={toggleDarkMode} data-mode={darkMode ? 'dark' : 'light'}>
      Toggle
    </button>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    installLocalStorageMock();
    localStorage.clear();
    document.documentElement.className = '';
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('defaults to dark mode and persists toggles', async () => {
    const view = await render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    const button = view.container.querySelector<HTMLButtonElement>('button');
    expect(button?.dataset.mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('darkMode')).toBe('true');

    await click(button);

    expect(button?.dataset.mode).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('darkMode')).toBe('false');

    await view.unmount();
  });

  it('hydrates from localStorage', async () => {
    localStorage.setItem('darkMode', 'false');

    const view = await render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    const button = view.container.querySelector<HTMLButtonElement>('button');
    expect(button?.dataset.mode).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);

    await view.unmount();
  });
});
