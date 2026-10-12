import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase.js';

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
    if (!SUPABASE_CONFIGURED || !supabase) {
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
    if (!SUPABASE_CONFIGURED || !supabase) {
      return { error: new Error('Connect this app to its new Supabase project by setting VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.') };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
    localStorage.removeItem('gsm_demo');
    return { user: data.user };
  };

  const signOut = async () => {
    localStorage.removeItem('gsm_demo');
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
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
