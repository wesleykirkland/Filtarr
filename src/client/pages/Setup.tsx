import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';

type AuthMode = 'none' | 'basic' | 'forms';
type Step = 'welcome' | 'auth-mode' | 'account' | 'complete';

interface SetupResponse {
  apiKey: string;
  message: string;
}

export default function Setup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('welcome');
  const [authMode, setAuthMode] = useState<AuthMode>('forms');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (authMode !== 'none') {
      if (password !== confirmPassword) {
        toast('error', 'Passwords do not match');
        return;
      }
      if (password.length < 8) {
        toast('error', 'Password must be at least 8 characters');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await api.post<SetupResponse>('/setup/complete', {
        authMode,
        username: authMode !== 'none' ? username : 'admin',
        password: authMode !== 'none' ? password : 'unused',
      });
      setApiKey(res.apiKey);
      setStep('complete');

      // Invalidate setup status so SetupGuard knows setup is complete
      await queryClient.invalidateQueries({ queryKey: ['setup', 'status'] });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  /** Redirect based on auth mode after user acknowledges API key */
  const handleContinue = () => {
    if (authMode === 'forms') {
      // Forms auth requires login with the new credentials
      navigate('/login', { replace: true });
    } else {
      // 'none' or 'basic' - go to dashboard (basic will prompt via browser)
      navigate('/', { replace: true });
    }
  };

  const copyApiKey = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nextStep = () => {
    if (step === 'welcome') setStep('auth-mode');
    else if (step === 'auth-mode') {
      if (authMode === 'none') {
        // Skip account step for "none" mode
        handleSubmit(new Event('submit') as unknown as FormEvent);
      } else {
        setStep('account');
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center dark:bg-gray-950 bg-gray-50">
      <div className="w-full max-w-md rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <span className="text-5xl">🎬</span>
          <h1 className="mt-2 text-2xl font-bold dark:text-gray-100 text-gray-900">
            {step === 'complete' ? 'Setup Complete!' : 'Welcome to Filtarr'}
          </h1>
          {step !== 'complete' && (
            <div className="mt-4 flex justify-center gap-2">
              {['welcome', 'auth-mode', 'account'].map((s, i) => (
                <div
                  key={s}
                  className={`h-2 w-8 rounded ${
                    ['welcome', 'auth-mode', 'account'].indexOf(step) >= i
                      ? 'bg-blue-500'
                      : 'dark:bg-gray-700 bg-gray-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="space-y-4">
            <p className="dark:text-gray-400 text-gray-700">
              Filtarr helps you manage your Arr stack with intelligent file monitoring, blocklist
              management, and automation tools.
            </p>
            <p className="dark:text-gray-400 text-gray-700">
              Let's get you set up in just a few steps.
            </p>
            <button
              onClick={nextStep}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step: Auth Mode */}
        {step === 'auth-mode' && (
          <div className="space-y-4">
            <p className="text-sm dark:text-gray-400 text-gray-700">
              Choose how you want to secure your Filtarr instance:
            </p>
            <div className="space-y-3">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                  authMode === 'forms'
                    ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                    : 'dark:border-gray-700 border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="authMode"
                  value="forms"
                  checked={authMode === 'forms'}
                  onChange={() => setAuthMode('forms')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium dark:text-gray-100 text-gray-900">
                    Forms Authentication
                  </div>
                  <div className="text-sm dark:text-gray-400 text-gray-600">
                    Username/password login form (recommended)
                  </div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                  authMode === 'basic'
                    ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                    : 'dark:border-gray-700 border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="authMode"
                  value="basic"
                  checked={authMode === 'basic'}
                  onChange={() => setAuthMode('basic')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium dark:text-gray-100 text-gray-900">
                    Basic Authentication
                  </div>
                  <div className="text-sm dark:text-gray-400 text-gray-600">
                    HTTP Basic auth (browser login prompt)
                  </div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                  authMode === 'none'
                    ? 'border-yellow-500 dark:bg-yellow-500/10 bg-yellow-50'
                    : 'dark:border-gray-700 border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="authMode"
                  value="none"
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium dark:text-gray-100 text-gray-900">
                    No Authentication
                  </div>
                  <div className="text-sm text-yellow-600 dark:text-yellow-400">
                    ⚠️ Only use on trusted networks
                  </div>
                </div>
              </label>
            </div>

            <button
              onClick={nextStep}
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Setting up...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step: Account */}
        {step === 'account' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm dark:text-gray-400 text-gray-700">Create your admin account:</p>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium dark:text-gray-400 text-gray-700"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium dark:text-gray-400 text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs dark:text-gray-500 text-gray-600">Minimum 8 characters</p>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium dark:text-gray-400 text-gray-700"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating account...' : 'Complete Setup'}
            </button>
          </form>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4">
              <p className="text-sm text-green-400">✓ Your Filtarr instance is ready to use!</p>
            </div>

            <div>
              <label className="block text-sm font-medium dark:text-gray-400 text-gray-700">
                Your API Key
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={apiKey}
                  className="block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 font-mono text-sm dark:text-gray-100 text-gray-900"
                />
                <button
                  onClick={copyApiKey}
                  className="rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-400 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-50"
                >
                  {copied ? '✓' : '📋'}
                </button>
              </div>
              <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                ⚠️ Save this API key — it will not be shown again!
              </p>
            </div>

            <button
              onClick={handleContinue}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
            >
              {authMode === 'forms' ? 'Continue to Login' : 'Continue to Dashboard'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
