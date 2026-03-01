import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
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
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <span className="text-5xl">🎬</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-100">
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
                      : 'bg-gray-700'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="space-y-4">
            <p className="text-gray-400">
              Filtarr helps you manage your Arr stack with intelligent file monitoring,
              blocklist management, and automation tools.
            </p>
            <p className="text-gray-400">
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
            <p className="text-sm text-gray-400">
              Choose how you want to secure your Filtarr instance:
            </p>
            <div className="space-y-3">
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                authMode === 'forms' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700'
              }`}>
                <input
                  type="radio"
                  name="authMode"
                  value="forms"
                  checked={authMode === 'forms'}
                  onChange={() => setAuthMode('forms')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-100">Forms Authentication</div>
                  <div className="text-sm text-gray-400">Username/password login form (recommended)</div>
                </div>
              </label>

              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                authMode === 'basic' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700'
              }`}>
                <input
                  type="radio"
                  name="authMode"
                  value="basic"
                  checked={authMode === 'basic'}
                  onChange={() => setAuthMode('basic')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-100">Basic Authentication</div>
                  <div className="text-sm text-gray-400">HTTP Basic auth (browser login prompt)</div>
                </div>
              </label>

              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${
                authMode === 'none' ? 'border-yellow-500 bg-yellow-500/10' : 'border-gray-700'
              }`}>
                <input
                  type="radio"
                  name="authMode"
                  value="none"
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-100">No Authentication</div>
                  <div className="text-sm text-yellow-400">⚠️ Only use on trusted networks</div>
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
            <p className="text-sm text-gray-400">Create your admin account:</p>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-400">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-400">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">Minimum 8 characters</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-400">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
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
              <p className="text-sm text-green-400">
                ✓ Your Filtarr instance is ready to use!
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400">Your API Key</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={apiKey}
                  className="block w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100"
                />
                <button
                  onClick={copyApiKey}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-400 hover:bg-gray-700"
                >
                  {copied ? '✓' : '📋'}
                </button>
              </div>
              <p className="mt-2 text-xs text-yellow-400">
                ⚠️ Save this API key — it will not be shown again!
              </p>
            </div>

            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
            >
              Continue to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

