import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

const BASE = import.meta.env.VITE_API_URL || '';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);          // Supabase auth user (id, email)
  const [profile, setProfile] = useState(null);    // { role, display_name, team_member_id }
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  // Fetch the team_members row for the current Supabase user.
  // If the user is signed in to Supabase but has no team_members row, treat
  // them as unauthorized (the backend will reject every API call anyway).
  const refreshProfile = useCallback(async (currentSession) => {
    const session = currentSession || (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) {
      setProfile(null);
      setProfileError('');
      return;
    }
    try {
      const res = await fetch(`${BASE}/api/team/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error || `HTTP ${res.status}`;
        setProfile(null);
        setProfileError(msg);
        return;
      }
      const data = await res.json();
      setProfile(data);
      setProfileError('');
    } catch (err) {
      console.error('[auth] could not fetch profile:', err.message);
      setProfile(null);
      setProfileError(err.message);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) await refreshProfile(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) await refreshProfile(session);
      else setProfile(null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [refreshProfile]);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signUp = (email, password) => supabase.auth.signUp({ email, password });
  const signOut = () => supabase.auth.signOut();

  const role = profile?.role || null;
  const isAdmin = role === 'admin';
  const isMember = role === 'member';
  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'User';

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      role,
      isAdmin,
      isMember,
      displayName,
      loading,
      profileError,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
