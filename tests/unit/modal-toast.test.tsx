// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../src/client/components/ConfirmDialog';
import {
  ActivityIcon,
  DashboardIcon,
  FiltersIcon,
  FolderIcon,
  InstancesIcon,
  KeyIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SchedulerIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  SunIcon,
} from '../../src/client/components/Icons';
import { Modal } from '../../src/client/components/Modal';
import { ToastContainer, toast } from '../../src/client/components/Toast';
import { click, render } from '../support/render';

describe('modal, toast, and dialog components', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the icon set and confirm dialog actions', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const view = await render(
      <div>
        <DashboardIcon /><InstancesIcon /><FiltersIcon /><SchedulerIcon /><ActivityIcon />
        <SettingsIcon /><SunIcon /><MoonIcon /><MenuIcon /><FolderIcon /><KeyIcon />
        <ShieldIcon /><SparklesIcon /><PlusIcon />
        <ConfirmDialog isOpen title="Delete" description="Confirm delete" onConfirm={onConfirm} onClose={onClose} />
      </div>,
    );

    expect(document.body.querySelectorAll('svg')).toHaveLength(15);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Confirm') ?? null);
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Cancel') ?? null);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('traps focus and closes the modal with keyboard and backdrop interactions', async () => {
    const launcher = document.createElement('button');
    launcher.textContent = 'launch';
    document.body.appendChild(launcher);
    launcher.focus();

    const onClose = vi.fn();
    const view = await render(
      <Modal title="Example" isOpen onClose={onClose}>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    );

    const dialog = document.body.querySelector('dialog') as HTMLElement;
    const [closeButton, , last] = Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[];
    expect(document.activeElement).toBe(closeButton);

    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(last);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => dialog.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);

    await view.unmount();
    expect(document.activeElement).toBe(launcher);
    launcher.remove();
  });

  it('adds, dismisses, and auto-removes toast notifications', async () => {
    vi.useFakeTimers();
    const view = await render(<ToastContainer />);

    act(() => toast('success', 'Saved successfully'));
    expect(document.body.textContent).toContain('Saved successfully');
    await click(document.body.querySelector('[aria-label="Dismiss notification"]'));
    expect(document.body.textContent).not.toContain('Saved successfully');

    act(() => toast('error', 'Something failed'));
    expect(document.body.querySelector('[aria-live="assertive"]')?.textContent).toContain('Something failed');
    act(() => vi.advanceTimersByTime(4000));
    expect(document.body.textContent).not.toContain('Something failed');

    await view.unmount();
  });
});