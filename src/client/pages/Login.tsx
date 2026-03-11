import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { toast } from '../components/Toast';

export default function Login() {
  const { login, session, isLoading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If already authenticated or auth is disabled, redirect
  if (!isLoading && session?.authenticated) {
    navigate('/', { replace: true });
    return null;
  }

  if (!isLoading && session?.mode === 'basic') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
        <Card className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <span className="text-4xl">🎬</span>
            <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Filtarr</h1>
            <p className="mt-1 text-sm text-gray-500">Basic Authentication</p>
          </div>

          <div className="space-y-4 text-center">
            <p className="text-gray-700 dark:text-gray-300">This instance uses HTTP Basic Authentication.</p>
            <p className="text-sm text-gray-500">
              Your browser should prompt you for credentials automatically. If you're not being
              prompted, try refreshing the page.
            </p>
            <Button fullWidth onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!isLoading && session?.mode === 'oidc') {
    return (
      <div className="flex min-h-screen items-center justify-center dark:bg-gray-950 bg-gray-50">
        <div className="w-full max-w-sm rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-8">
          <div className="mb-6 text-center">
            <span className="text-4xl">🎬</span>
            <h1 className="mt-2 text-2xl font-bold dark:text-gray-100 text-gray-900">Filtarr</h1>
            <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">OIDC Authentication</p>
          </div>

          <div className="space-y-4 text-center">
            <p className="dark:text-gray-400 text-gray-700">
              This instance uses OpenID Connect for sign-in.
            </p>
            <button
              onClick={() => window.location.assign('/api/v1/auth/login')}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              Continue with OIDC
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="text-4xl">🎬</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">Filtarr</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Username" htmlFor="username">
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="admin"
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
