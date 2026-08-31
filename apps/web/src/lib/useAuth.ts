import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'needs-enrollment'
  | 'needs-challenge'
  | 'authenticated';

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);

  const evaluate = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentSession = sessionData.session;
    setSession(currentSession);

    if (!currentSession) {
      setStatus('signed-out');
      return;
    }

    const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !aal) {
      setStatus('signed-out');
      return;
    }

    if (aal.currentLevel === 'aal2') {
      setStatus('authenticated');
    } else if (aal.nextLevel === 'aal2') {
      // Factors are enrolled but this session hasn't verified one yet.
      setStatus('needs-challenge');
    } else {
      // No MFA factors exist at all — mandatory enrollment, not optional.
      setStatus('needs-enrollment');
    }
  }, []);

  useEffect(() => {
    void evaluate();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void evaluate();
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  return { status, session, refresh: evaluate };
}
