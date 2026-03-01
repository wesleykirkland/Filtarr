import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/instances', label: 'Instances', icon: '🔗' },
  { to: '/filters', label: 'Filters', icon: '🔍' },
  { to: '/scheduler', label: 'Scheduler', icon: '⏰' },
  { to: '/activity', label: 'Activity', icon: '📋' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, logout } = useAuth();
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
    document.documentElement.classList.toggle('light');
  };

  const userName = session?.user?.displayName || session?.user?.username || 'User';

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col transition-transform lg:static lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'} border-r`}>
        <div className="flex h-16 items-center gap-2 px-6 border-b border-inherit">
          <span className="text-2xl">🎬</span>
          <h1 className="text-xl font-bold">Filtarr</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? darkMode ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-700'
                    : darkMode ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={`border-t p-4 ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <button
            onClick={toggleDarkMode}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              darkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {darkMode ? '☀️' : '🌙'} {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className={`flex h-16 items-center justify-between border-b px-6 ${
          darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
        }`}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-400 hover:text-gray-200"
          >
            ☰
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            {session?.authenticated && (
              <>
                <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{userName}</span>
                {session.mode !== 'none' && (
                  <button
                    onClick={() => logout()}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Logout
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

