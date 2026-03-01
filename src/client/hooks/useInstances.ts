import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';

export interface Instance {
  id: number;
  name: string;
  type: string;
  url: string;
  api_key_masked: string;
  timeout: number;
  enabled: number;
  skipSslVerify: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateInstanceInput {
  name: string;
  type: string;
  url: string;
  apiKey: string;
  timeout?: number;
  enabled?: boolean;
  skipSslVerify?: boolean;
}

export interface TestResult {
  success: boolean;
  version?: string;
  error?: string;
}

export function useInstances() {
  return useQuery({
    queryKey: ['instances'],
    queryFn: () => api.get<Instance[]>('/instances'),
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInstanceInput) => api.post<Instance>('/instances', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] });
      toast('success', 'Instance created');
    },
    onError: (err: Error) => toast('error', err.message),
  });
}

export function useUpdateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CreateInstanceInput> & { id: number }) =>
      api.put<Instance>(`/instances/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] });
      toast('success', 'Instance updated');
    },
    onError: (err: Error) => toast('error', err.message),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/instances/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] });
      toast('success', 'Instance deleted');
    },
    onError: (err: Error) => toast('error', err.message),
  });
}

export function useTestInstance() {
  return useMutation({
    mutationFn: (id: number) => api.get<TestResult>(`/instances/${id}/test`),
    onSuccess: (data) => {
      if (data.success) {
        toast('success', `Connection OK${data.version ? ` (v${data.version})` : ''}`);
      } else {
        toast('error', data.error || 'Connection failed');
      }
    },
    onError: (err: Error) => toast('error', err.message),
  });
}

export function useTestUnsavedInstance() {
  return useMutation({
    mutationFn: (input: CreateInstanceInput) => api.post<TestResult>('/instances/test', input),
    onSuccess: (data) => {
      if (data.success) {
        toast('success', `Connection OK${data.version ? ` (v${data.version})` : ''}`);
      } else {
        toast('error', data.error || 'Connection failed');
      }
    },
    onError: (err: Error) => toast('error', err.message),
  });
}
