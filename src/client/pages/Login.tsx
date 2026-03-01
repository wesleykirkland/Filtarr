import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
      <div className="flex min-h-screen items-center justify-center dark:bg-gray-950 bg-gray-50">
        <div className="w-full max-w-sm rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-8">
          <div className="mb-6 text-center">
            <span className="text-4xl">🎬</span>
            <h1 className="mt-2 text-2xl font-bold dark:text-gray-100 text-gray-900">Filtarr</h1>
            <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">Basic Authentication</p>
          </div>

          <div className="space-y-4 text-center">
            <p className="dark:text-gray-400 text-gray-700">
              This instance uses HTTP Basic Authentication.
            </p>
            <p className="text-sm dark:text-gray-500 text-gray-600">
              Your browser should prompt you for credentials automatically. If you're not being
              prompted, try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              Refresh Page
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
    <div className="flex min-h-screen items-center justify-center dark:bg-gray-950 bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border dark:border-gray-800 border-gray-200 dark:bg-gray-900 bg-white shadow-sm p-8">
        <div className="mb-6 text-center">
          <span className="text-4xl">🎬</span>
          <h1 className="mt-2 text-2xl font-bold dark:text-gray-100 text-gray-900">Filtarr</h1>
          <p className="mt-1 text-sm dark:text-gray-500 text-gray-600">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 dark:placeholder-gray-500 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="admin"
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
              className="mt-1 block w-full rounded-lg border dark:border-gray-700 border-gray-300 dark:bg-gray-800 bg-white px-3 py-2 dark:text-gray-100 text-gray-900 dark:placeholder-gray-500 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
