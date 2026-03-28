// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderResult {
  container: HTMLDivElement;
  rerender: (ui: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

export async function render(ui: ReactElement): Promise<RenderResult> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root: Root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });

  return {
    container,
    rerender: async (nextUi: ReactElement) => {
      await act(async () => {
        root.render(nextUi);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('Expected an HTMLElement to click');
  }

  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

export async function waitFor(
  assertion: () => void,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    });
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for condition');
}