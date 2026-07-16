const STORAGE_KEY = 'birdie-theme';

export type Theme = 'light' | 'dark';

export function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable (private mode, disabled storage) - theme just won't persist
  }
}
