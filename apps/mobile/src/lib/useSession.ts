import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Diner auth is simpler than staff's: no MFA (PRD §12.2 only requires it for
// restaurant staff), and Anonymous Sign-In is a legitimate signed-in state
// (a guest at a table), not a "signed out" one — see AFD §2.1 /
// API Specification §1.
export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStatus(data.session ? 'signed-in' : 'signed-out');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setStatus(newSession ? 'signed-in' : 'signed-out');
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { session, status };
}
