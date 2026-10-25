import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface ThemeContextType {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredPreference(): string | null {
  try {
    return localStorage.getItem('darkMode');
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { readonly children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = readStoredPreference();
    if (saved !== null) return saved === 'true';
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
    try {
      localStorage.setItem('darkMode', String(darkMode));
    } catch {
      // Storage may be unavailable (private mode, blocked site data); theme still applies for this session.
    }
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => setDarkMode((prev) => !prev), []);
  const value = useMemo(() => ({ darkMode, toggleDarkMode }), [darkMode, toggleDarkMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
