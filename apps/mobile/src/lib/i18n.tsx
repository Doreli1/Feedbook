import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DevSettings, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import translations, { type Lang, type TranslationKey } from './translations';

export const LANG_STORAGE_KEY = 'feedbook-mobile-lang';

// Mirrors the Web Admin's lib/i18n.tsx pattern exactly (same flat-key
// `t()` shape, same persisted-choice approach) — but RTL here is a native
// I18nManager flag, not a CSS `dir` attribute: flipping it only takes
// visual effect after a full JS reload (see app/_layout.tsx's own comment
// on this — the same real bug fixed there today). setLang below reloads
// immediately when the chosen language actually changes direction (he↔en),
// the same self-healing pattern used at boot.
export async function getPersistedLang(): Promise<Lang> {
  try {
    const saved = await AsyncStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(I18nManager.isRTL ? 'he' : 'en');

  useEffect(() => {
    void getPersistedLang().then(setLangState);
  }, []);

  // Real bug fix (2026-10-11, found while investigating a user report that
  // looked like a stale account-screen realtime subscription): setLang/t
  // and the context value object were all plain function/object literals
  // recreated on every I18nProvider render — which, since this provider
  // sits near the app root, meant every consumer's own `t` got a brand new
  // identity on essentially every render anywhere in the tree, regardless
  // of whether the language itself ever changed. Several hooks across this
  // app (e.g. useAccountItems.ts) put `t` directly in a useCallback/
  // useEffect dependency array — with `t` this unstable, those effects
  // (including realtime subscriptions) were tearing down and recreating
  // far more often than their own logic ever intended, not just on actual
  // language changes. Memoized so `t`/setLang/the context value are only
  // ever new when `lang` itself actually changes.
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void AsyncStorage.setItem(LANG_STORAGE_KEY, next).catch(() => {
      // AsyncStorage can fail in rare low-storage conditions — the choice
      // just won't persist across app restarts, a harmless fallback.
    });
    const shouldBeRTL = next === 'he';
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(shouldBeRTL);
      DevSettings.reload();
    }
  }, []);

  const t = useCallback((key: TranslationKey): string => translations[lang][key], [lang]);

  const value = useMemo(() => ({ lang, setLang, t, isRTL: lang === 'he' }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
