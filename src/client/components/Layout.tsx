import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ActivityIcon,
  DashboardIcon,
  FiltersIcon,
  InstancesIcon,
  MenuIcon,
  MoonIcon,
  SchedulerIcon,
  SettingsIcon,
  SunIcon,
} from './Icons';
import { Button, cn } from './ui';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';

const navItems = [
  { to: '/', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/instances', label: 'Instances', Icon: InstancesIcon },
  { to: '/filters', label: 'Filters', Icon: FiltersIcon },
  { to: '/scheduler', label: 'Scheduler', Icon: SchedulerIcon },
  { to: '/activity', label: 'Activity', Icon: ActivityIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, logout } = useAuth();
  const { darkMode, toggleDarkMode } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const userName = session?.user?.displayName || session?.user?.username || 'User';

  return (
    <div className={cn('flex h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100')}>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0 dark:border-gray-800 dark:bg-gray-900',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="border-b border-inherit px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-lg font-bold text-white shadow-lg shadow-blue-600/20">
              F
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Filtarr</h1>
              <p className="text-xs text-gray-500">Automation hub for your Arr stack</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900',
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-4 dark:border-gray-800">
          <Button variant="secondary" fullWidth onClick={toggleDarkMode} className="justify-start">
            {darkMode ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            {darkMode ? 'Light mode' : 'Dark mode'}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900">
          <Button
            variant="ghost"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <MenuIcon className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            {session?.authenticated ? (
              <>
                <div className="hidden rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:block">
                  {userName}
                </div>
                {session.mode !== 'none' ? (
                  <Button variant="ghost" size="sm" onClick={() => logout()}>
                    Logout
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
