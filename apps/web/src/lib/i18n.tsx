import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import translations, { type Lang, type TranslationKey } from './translations';

const STORAGE_KEY = 'feedbook-lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
  dir: 'rtl' | 'ltr';
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'he' ? saved : 'he';
  } catch {
    return 'he';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const dir: 'rtl' | 'ltr' = lang === 'he' ? 'rtl' : 'ltr';

  // The whole document's dir/lang follow the chosen language, so every
  // screen — including ones that forget to set it locally — stays
  // consistent. This is exactly what was missing before: MfaEnroll/
  // MfaChallenge were hardcoded English/LTR regardless of what the user
  // picked on the sign-in screen. Whichever screen the LanguageToggle is
  // clicked from, the choice applies everywhere from that point on.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  // Real bug fix (2026-10-11, same root cause found on the mobile side —
  // see that file's own comment): setLang/t and the context value object
  // were plain function/object literals recreated on every I18nProvider
  // render, so every consumer's `t` got a brand-new identity on
  // essentially every render anywhere in the tree, not just on an actual
  // language change. Any hook that put `t` in a useCallback/useEffect
  // dependency array (e.g. a realtime subscription) was tearing down and
  // recreating far more often than intended. Memoized so `t`/setLang/the
  // context value only change when `lang` itself actually does.
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can throw in private-browsing contexts — the choice
      // just won't persist across reloads, which is a harmless fallback.
    }
  }, []);

  const t = useCallback((key: TranslationKey): string => translations[lang][key], [lang]);

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
