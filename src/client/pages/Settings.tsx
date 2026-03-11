import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import SettingsApiKeysPage from './settings/SettingsApiKeysPage';
import SettingsAuthenticationPage from './settings/SettingsAuthenticationPage';
import SettingsBackupPage from './settings/SettingsBackupPage';
import SettingsGeneralPage from './settings/SettingsGeneralPage';
import SettingsNotificationsPage from './settings/SettingsNotificationsPage';

const sections = [
  {
    label: 'General',
    description: 'App behavior and instance validation settings.',
    path: '/settings/general',
    element: <SettingsGeneralPage />,
  },
  {
    label: 'Notifications',
    description: 'Global Slack/webhook defaults and test actions.',
    path: '/settings/notifications',
    element: <SettingsNotificationsPage />,
  },
  {
    label: 'Authentication',
    description: 'Basic, forms, and OIDC sign-in configuration.',
    path: '/settings/authentication',
    element: <SettingsAuthenticationPage />,
  },
  {
    label: 'API Keys',
    description: 'Rotate API keys used for programmatic access.',
    path: '/settings/api-keys',
    element: <SettingsApiKeysPage />,
  },
  {
    label: 'Backup & Restore',
    description: 'Reserved location for import/export workflows.',
    path: '/settings/backup',
    element: <SettingsBackupPage />,
  },
];

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Manage Filtarr through focused settings pages similar to Sonarr/Radarr.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-2">
            {sections.map((section) => (
              <NavLink
                key={section.path}
                to={section.path}
                className={({ isActive }) =>
                  `block rounded-lg border px-4 py-3 transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                      : 'border-transparent text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/70'
                  }`
                }
              >
                <div className="text-sm font-medium">{section.label}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {section.description}
                </div>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="general" replace />} />
            {sections.map((section) => (
              <Route
                key={section.path}
                path={section.path.replace('/settings/', '')}
                element={section.element}
              />
            ))}
            <Route path="*" element={<Navigate to="general" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
