import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { api } from './lib/api';
import Layout from './components/Layout';
import { Button, Card } from './components/ui';
import Dashboard from './pages/Dashboard';
import Instances from './pages/Instances';
import Filters from './pages/Filters';
import Scheduler from './pages/Scheduler';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Setup from './pages/Setup';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { getProtectedRouteState } from './lib/session';

interface SetupStatus {
  needsSetup: boolean;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error, retrySession } = useAuth();

  const { darkMode } = useTheme();
  const routeState = getProtectedRouteState({ session, error });

  if (isLoading) {
    return (
      <div
        className={`flex h-screen items-center justify-center ${darkMode ? 'bg-gray-950 text-gray-400' : 'bg-gray-50 text-gray-500'}`}
      >
        <div>Loading...</div>
      </div>
    );
  }

  if (routeState.state === 'retry') {
    return (
      <div
        className={`flex min-h-screen items-center justify-center px-4 ${darkMode ? 'bg-gray-950' : 'bg-gray-50'}`}
      >
        <Card className="max-w-lg">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{routeState.title}</h2>
          <p className="mt-2 text-sm text-gray-500">{routeState.description}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => retrySession()}>Retry session check</Button>
            <Button variant="secondary" onClick={() => globalThis.location.reload()}>
              Reload page
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (routeState.state === 'login') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Check setup status and redirect to /setup if needed.
 * Wraps the entire app to ensure setup is checked on every route.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: setupStatus, isLoading } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => api.get<SetupStatus>('/setup/status'),
    staleTime: 60_000,
    retry: false,
  });

  const { darkMode } = useTheme();

  if (isLoading) {
    return (
      <div
        className={`flex h-screen items-center justify-center ${darkMode ? 'bg-gray-950 text-gray-400' : 'bg-gray-50 text-gray-500'}`}
      >
        <div>Loading...</div>
      </div>
    );
  }

  // Redirect to setup if needed (unless already on setup page)
  if (setupStatus?.needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  // Redirect away from setup if already completed
  if (!setupStatus?.needsSetup && location.pathname === '/setup') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <SetupGuard>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/instances" element={<Instances />} />
                    <Route path="/filters" element={<Filters />} />
                    <Route path="/scheduler" element={<Scheduler />} />
                    <Route path="/activity" element={<Activity />} />
                    <Route path="/settings/*" element={<Settings />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </SetupGuard>
    </ThemeProvider>
  );
}
