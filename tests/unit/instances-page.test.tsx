// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Instances from '../../src/client/pages/Instances';
import { click, render, waitFor } from '../support/render';

const state = vi.hoisted(() => ({
  instances: [] as any[],
  isLoading: false,
  unsavedResult: { success: true },
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  testMutate: vi.fn(),
  testUnsavedMutate: vi.fn(),
}));

vi.mock('../../src/client/hooks/useInstances', () => ({
  useInstances: () => ({ data: state.instances, isLoading: state.isLoading }),
  useCreateInstance: () => ({ mutate: state.createMutate, isPending: false }),
  useUpdateInstance: () => ({ mutate: state.updateMutate, isPending: false }),
  useDeleteInstance: () => ({ mutate: state.deleteMutate, isPending: false }),
  useTestInstance: () => ({ mutate: state.testMutate, isPending: false }),
  useTestUnsavedInstance: () => ({ mutate: state.testUnsavedMutate, isPending: false }),
}));

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setChecked(input: HTMLInputElement, checked: boolean) {
  await act(async () => {
    if (input.checked !== checked) input.click();
  });
}

describe('Instances page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    state.instances = [];
    state.isLoading = false;
    state.unsavedResult = { success: true };
    state.createMutate.mockReset().mockImplementation((_input: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    state.updateMutate.mockReset().mockImplementation((_input: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    state.deleteMutate.mockReset().mockImplementation((_id: number, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    state.testMutate.mockReset();
    state.testUnsavedMutate.mockReset().mockImplementation((_input: unknown, options?: { onSuccess?: (value: { success: boolean }) => void }) => options?.onSuccess?.(state.unsavedResult));
  });

  it('creates a new instance after a successful connection test', async () => {
    const view = await render(<Instances />);

    expect(document.body.textContent).toContain('No instances configured');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Add Instance')) ?? null);

    const inputs = Array.from(document.body.querySelectorAll('input'));
    await setInputValue(inputs.find((node) => node.id === 'instance-name')!, 'Movies');
    await setInputValue(inputs.find((node) => node.id === 'instance-url')!, 'https://radarr.example.com');
    await setInputValue(inputs.find((node) => node.id === 'instance-api-key')!, 'secret');
    await setInputValue(inputs.find((node) => node.id === 'instance-timeout')!, '45');
    await setChecked(inputs.find((node) => node.id === 'skipSslVerify')!, true);

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Test Connection') ?? null);
    await waitFor(() => {
      expect(state.testUnsavedMutate).toHaveBeenCalled();
    });

    expect(state.testUnsavedMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Movies',
        type: 'sonarr',
        url: 'https://radarr.example.com',
        apiKey: 'secret',
        timeout: 45,
        skipSslVerify: true,
      }),
      expect.any(Object),
    );

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Create Connection') ?? null);

    expect(state.createMutate).toHaveBeenCalledWith(
      {
        name: 'Movies',
        type: 'sonarr',
        url: 'https://radarr.example.com',
        apiKey: 'secret',
        timeout: 45,
        skipSslVerify: true,
        remotePath: null,
        localPath: null,
      },
      expect.any(Object),
    );
    await view.unmount();
  });

  it('tests saved instances, updates an existing one, and confirms deletion', async () => {
    state.instances = [{
      id: 1,
      name: 'Primary Sonarr',
      type: 'sonarr',
      url: 'https://sonarr.example.com',
      api_key_masked: '••••••',
      timeout: 30,
      enabled: 1,
      skipSslVerify: false,
      remotePath: '/downloads',
      localPath: '/mnt/downloads',
      created_at: '',
      updated_at: '',
    }];

    const view = await render(<Instances />);

    expect(document.body.textContent).toContain('Primary Sonarr');
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Test') ?? null);
    expect(state.testMutate).toHaveBeenCalledWith(1);

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Edit') ?? null);
    const inputs = Array.from(document.body.querySelectorAll('input'));
    await setInputValue(inputs.find((node) => node.id === 'instance-url')!, 'https://updated.example.com');
    await setChecked(inputs.find((node) => node.id === 'skipSslVerify')!, true);

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Test Connection') ?? null);
    await waitFor(() => {
      expect(state.testUnsavedMutate).toHaveBeenCalled();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Update Connection') ?? null);

    expect(state.testUnsavedMutate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: '••••••', url: 'https://updated.example.com', skipSslVerify: true }),
      expect.any(Object),
    );
    expect(state.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, url: 'https://updated.example.com', skipSslVerify: true }),
      expect.any(Object),
    );

    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete') ?? null);
    await waitFor(() => {
      expect(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete instance')).toBeTruthy();
    });
    await click(Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent === 'Delete instance') ?? null);
    expect(state.deleteMutate).toHaveBeenCalledWith(1, expect.any(Object));
    await view.unmount();
  });
});
