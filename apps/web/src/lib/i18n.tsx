import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  // The whole document's dir/lang follow the chosen language, so every
  // screen — including ones that forget to set it locally — stays
  // consistent. This is exactly what was missing before: MfaEnroll/
  // MfaChallenge were hardcoded English/LTR regardless of what the user
  // picked on the sign-in screen.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  function setLang(next: Lang) {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can throw in private-browsing contexts — the choice
      // just won't persist across reloads, which is a harmless fallback.
    }
  }

  function t(key: TranslationKey): string {
    return translations[lang][key];
  }

  return <I18nContext.Provider value={{ lang, setLang, t, dir }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
