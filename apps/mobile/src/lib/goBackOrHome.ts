import type { ImperativeRouter } from 'expo-router';

// A header back button can be reached with an empty navigation stack behind
// it — not just via a real deep link, but also whenever the OS resumes a
// suspended process (or a dev client reconnects) directly onto whatever
// screen was last shown, skipping the app's own root/splash redirect
// entirely. router.back() in that state dispatches an unhandled GO_BACK
// action (real Console error seen in testing, 2026-09-11) instead of
// silently doing nothing. Falling back to the signed-in home screen keeps
// the button meaningful either way.
export function goBackOrHome(router: ImperativeRouter) {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/profile');
  }
}
