import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

const DEMO_USER = {
  id: 'demo-owner-user',
  email: 'demo@gsmtraders.in',
  role: 'authenticated',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const demoRequested = params.get('demo') === '1' || localStorage.getItem('gsm_demo') === '1';
    if (demoRequested) {
      localStorage.setItem('gsm_demo', '1');
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
    localStorage.removeItem('gsm_demo');
    return { user: data.user };
  };

  const signOut = async () => {
    localStorage.removeItem('gsm_demo');
    try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isAuthed: !!user, isDemo: user?.id === DEMO_USER.id }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
