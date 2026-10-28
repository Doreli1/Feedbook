import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import translations, { type Lang, type TranslationKey } from './translations';

export const LANG_STORAGE_KEY = 'feedbook-mobile-lang';

// Mirrors the Web Admin's lib/i18n.tsx pattern exactly (same flat-key
// `t()` shape, same persisted-choice approach). RTL is still a native
// I18nManager flag underneath (see app/_layout.tsx's useRTLSync for the
// boot-time self-heal that keeps it loosely in sync), but setLang below no
// longer touches it or reloads — see that function's own comment for why.
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
  // Real bug (2026-10-28, per explicit report): this used to call
  // I18nManager.forceRTL + DevSettings.reload() whenever the chosen
  // language changed direction (he↔en) — a full JS VM restart that always
  // landed back on Splash, with no idea what screen the diner was actually
  // on (lost navigation state, not just a jarring flash). It also explains
  // the asymmetry that was reported: the reload only fired when
  // I18nManager.isRTL (the NATIVE flag, confirmed stuck at false throughout
  // this app, not necessarily matching the chosen language at all) didn't
  // already match the new language — so on this device, switching to
  // English always already "matched" (no reload), switching to Hebrew never
  // did (always reloaded), which had nothing to do with the language itself,
  // just which direction happened to agree with the stuck flag.
  // No longer needed at all: every layout decision in this app now goes
  // through visualRowDirection/physicalReadingStart/physicalReadingEnd/
  // visualColumnAlign below, all of which counteract whatever
  // I18nManager.isRTL actually is instead of depending on it being correct
  // — so a plain state update is enough for the whole app to re-render
  // correctly in the new language immediately, with no reload and no lost
  // screen.
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void AsyncStorage.setItem(LANG_STORAGE_KEY, next).catch(() => {
      // AsyncStorage can fail in rare low-storage conditions — the choice
      // just won't persist across app restarts, a harmless fallback.
    });
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

// Real bug (2026-10-27): I18nManager.isRTL can get stuck not reflecting the
// chosen language even after forceRTL + a full app relaunch (confirmed on a
// real device — see useRTLSync above). Components that need a reliable
// row direction should compute it through this instead of plain `flex-row`
// className, which silently mirrors the wrong way whenever the native flag
// disagrees with the actual language. This counteracts whatever
// I18nManager.isRTL *actually* is right now, rather than assuming it's
// always false — so it keeps working correctly if the native flag is ever
// fixed upstream too (no double-flip), instead of only patching today's
// specific stuck state.
export function visualRowDirection(desiredRTL: boolean): 'row' | 'row-reverse' {
  return desiredRTL !== I18nManager.isRTL ? 'row-reverse' : 'row';
}

// Real bug (2026-10-27, found auditing LikeButton/PriceRow after the
// flexDirection sweep): RN's *logical* position/spacing props (`start`/
// `end`, `marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`) resolve
// through the exact same broken I18nManager.isRTL flag as flexDirection
// does — so they're just as unreliable here. A separate, older piece of
// this codebase (predating the SDK 58 upgrade) also assumed plain literal
// `left`/`right` on position:'absolute' get auto-mirrored by I18nManager —
// they never actually do in React Native (only flexDirection and the
// logical start/end-suffixed props are I18n-aware); that was a
// pre-existing misdiagnosis, not something the upgrade broke. Use these two
// instead of any start/end/left/right literal when you need a specific
// *reading-relative* physical side reliably: readingEnd is where a
// trailing decoration (e.g. a corner badge) should sit — physical left in
// Hebrew, physical right in English; readingStart is the opposite (where
// reading begins — physical right in Hebrew, physical left in English).
// Fully independent of I18nManager, so no counteracting formula is needed
// the way visualRowDirection needs one for flexDirection.
export function physicalReadingEnd(desiredRTL: boolean): 'left' | 'right' {
  return desiredRTL ? 'left' : 'right';
}
export function physicalReadingStart(desiredRTL: boolean): 'left' | 'right' {
  return desiredRTL ? 'right' : 'left';
}

// Real bug (2026-10-28, found auditing PriceRow/the addon-hint row after the
// start/end sweep): unlike alignItems/alignSelf's cross-axis on a ROW
// container (vertical, never RTL-sensitive), the cross axis on a COLUMN
// container is horizontal — so `flex-start`/`flex-end` there DOES resolve
// relative to I18nManager's direction (same underlying Yoga "start"/"end"
// concept flexDirection row/row-reverse uses), through the same stuck
// I18nManager.isRTL flag. The 134-occurrence flexDirection sweep searched
// for the literal text "flex-row" and never caught these, since they're
// plain alignItems/alignSelf values with no "row" in sight. Pass the
// PHYSICAL side you want the content to land on (get it from
// physicalReadingEnd/physicalReadingStart above) and this returns the
// literal flex-start/flex-end to assign, counteracting whatever
// I18nManager.isRTL actually is right now — same counteracting approach as
// visualRowDirection, just for the cross axis of a column instead of the
// main axis of a row.
export function visualColumnAlign(physicalSide: 'left' | 'right'): 'flex-start' | 'flex-end' {
  return (physicalSide === 'left') !== I18nManager.isRTL ? 'flex-start' : 'flex-end';
}
