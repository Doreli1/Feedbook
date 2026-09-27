import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

  function setLang(next: Lang) {
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
  }

  function t(key: TranslationKey): string {
    return translations[lang][key];
  }

  return <I18nContext.Provider value={{ lang, setLang, t, isRTL: lang === 'he' }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
