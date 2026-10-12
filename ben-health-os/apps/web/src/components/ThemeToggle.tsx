'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  useEffect(() => {
    try {
      const t = localStorage.getItem('bho-theme');
      if (t === 'dark' || t === 'light') setTheme(t);
    } catch {
      /* ignore */
    }
  }, []);
  function cycle() {
    const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    setTheme(next);
    try {
      if (next === 'system') {
        localStorage.removeItem('bho-theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('bho-theme', next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch {
      /* ignore */
    }
  }
  return (
    <button onClick={cycle} className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink" title="Theme" aria-label={`Theme: ${theme}`}>
      {theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'}
    </button>
  );
}
