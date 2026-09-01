import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'password-recovery-challenge'
  | 'password-recovery'
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

  // A password-recovery session starts at aal1. Supabase refuses
  // updateUser({ password }) for an MFA-enrolled account without an aal2
  // session ("AAL2 session is required to update email or password when
  // MFA is enabled") — caught by actually following a real reset-email
  // link through to submission, not by reading the docs. So a recovery
  // session with enrolled factors must clear an MFA challenge first.
  const evaluateRecovery = useCallback(async () => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel !== 'aal2' && aal.nextLevel === 'aal2') {
      setStatus('password-recovery-challenge');
    } else {
      setStatus('password-recovery');
    }
  }, []);

  useEffect(() => {
    void evaluate();
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSession(newSession);
        // Deferred: calling other supabase.auth methods synchronously inside
        // this callback can deadlock on the client's internal auth lock.
        setTimeout(() => void evaluateRecovery(), 0);
        return;
      }
      void evaluate();
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate, evaluateRecovery]);

  return { status, session, refresh: evaluate, refreshRecovery: evaluateRecovery };
}
