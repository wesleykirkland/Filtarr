import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Field, Input, checkboxStyles, cn } from '../components/ui';
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <Card className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <span className="text-5xl">🎬</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
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
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Filtarr helps you manage your Arr stack with intelligent file monitoring, blocklist
              management, and automation tools.
            </p>
            <p className="text-gray-700 dark:text-gray-300">Let's get you set up in just a few steps.</p>
            <Button fullWidth size="lg" onClick={nextStep}>
              Get Started
            </Button>
          </div>
        )}

        {/* Step: Auth Mode */}
        {step === 'auth-mode' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">Choose how you want to secure your Filtarr instance:</p>
            <div className="space-y-3">
              <label
                htmlFor="setup-auth-mode-forms"
                className={cn(`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  authMode === 'forms'
                    ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                    : 'border-gray-300 dark:border-gray-700'
                }`, 'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:focus-within:ring-offset-gray-900')}
              >
                <input
                  id="setup-auth-mode-forms"
                  type="radio"
                  name="authMode"
                  value="forms"
                  checked={authMode === 'forms'}
                  onChange={() => setAuthMode('forms')}
                  className={checkboxStyles('mt-1 rounded-full')}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">Forms Authentication</div>
                  <div className="text-sm text-gray-500">Username/password login form (recommended)</div>
                </div>
              </label>

              <label
                htmlFor="setup-auth-mode-basic"
                className={cn(`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  authMode === 'basic'
                    ? 'border-blue-500 dark:bg-blue-500/10 bg-blue-50'
                    : 'border-gray-300 dark:border-gray-700'
                }`, 'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:focus-within:ring-offset-gray-900')}
              >
                <input
                  id="setup-auth-mode-basic"
                  type="radio"
                  name="authMode"
                  value="basic"
                  checked={authMode === 'basic'}
                  onChange={() => setAuthMode('basic')}
                  className={checkboxStyles('mt-1 rounded-full')}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">Basic Authentication</div>
                  <div className="text-sm text-gray-500">HTTP Basic auth (browser login prompt)</div>
                </div>
              </label>

              <label
                htmlFor="setup-auth-mode-none"
                className={cn(`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  authMode === 'none'
                    ? 'border-yellow-500 dark:bg-yellow-500/10 bg-yellow-50'
                    : 'border-gray-300 dark:border-gray-700'
                }`, 'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:focus-within:ring-offset-gray-900')}
              >
                <input
                  id="setup-auth-mode-none"
                  type="radio"
                  name="authMode"
                  value="none"
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                  className={checkboxStyles('mt-1 rounded-full')}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">No Authentication</div>
                  <div className="text-sm text-yellow-600 dark:text-yellow-400">⚠️ Only use on trusted networks</div>
                </div>
              </label>
            </div>

            <Button fullWidth size="lg" onClick={nextStep} disabled={submitting}>
              {submitting ? 'Setting up...' : 'Continue'}
            </Button>
          </div>
        )}

        {/* Step: Account */}
        {step === 'account' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">Create your admin account:</p>

            <Field label="Username" htmlFor="username">
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>

            <Field label="Password" htmlFor="password" description="Minimum 8 characters">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </Field>

            <Field label="Confirm Password" htmlFor="confirmPassword">
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </Field>

            <Button type="submit" fullWidth size="lg" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Complete Setup'}
            </Button>
          </form>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4">
              <Badge variant="success">Ready</Badge>
              <p className="mt-2 text-sm text-green-700 dark:text-green-300">✓ Your Filtarr instance is ready to use!</p>
            </div>

            <Field label="Your API Key" htmlFor="setup-api-key">
              <div className="flex gap-2">
                <Input
                  id="setup-api-key"
                  type="text"
                  readOnly
                  value={apiKey}
                  className="font-mono"
                />
                <Button variant="secondary" onClick={copyApiKey} aria-label="Copy API key">
                  {copied ? '✓' : '📋'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">⚠️ Save this API key — it will not be shown again!</p>
            </Field>

            <Button fullWidth size="lg" onClick={handleContinue}>
              {authMode === 'forms' ? 'Continue to Login' : 'Continue to Dashboard'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
