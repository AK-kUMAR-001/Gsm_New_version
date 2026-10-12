import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { SUPABASE_CONFIGURED } from '../lib/supabase.js';

function LeafLogo({ className = 'w-16 h-16' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none">
      <rect width="64" height="64" rx="16" fill="#05df72" />
      <path
        d="M40 18c-8 0-14 6-14 14 0 8 6 14 14 14 2 0 4-.4 5.6-1.2C42 45 36 40 34 32c-2-8 2-14 6-14zm-2 4c-3 1-5 5-4 10 1 5 4 8 7 9-1-4-1-13-3-19z"
        stroke="#0f3460"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M28 46c7 4 14 4 18 0" stroke="#0f3460" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export default function Login() {
  const { signIn, isAuthed } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (isAuthed) { setTimeout(() => nav('/dashboard', { replace: true }), 0); }

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) {
      setErr(error.message || 'Sign-in failed');
      return;
    }
    nav('/dashboard', { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-sidebar via-sidebar-mid to-sidebar-accent text-white">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-green/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 w-[28rem] h-[28rem] rounded-full bg-brand-purple/10 blur-3xl" />

      <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center mb-8 animate-fadeIn">
          <LeafLogo className="w-16 h-16" />
          <h1 className="mt-5 text-3xl md:text-4xl font-extrabold tracking-tight">GSM Traders</h1>
          <p className="mt-2 text-white/60 text-sm md:text-base">Ukkadam Market Road, Coimbatore</p>
        </div>

        <form
          onSubmit={submit}
          className="w-full max-w-md bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-7 md:p-8 shadow-2xl animate-slideUp"
        >
          <h2 className="text-2xl font-bold mb-6">Welcome back</h2>

          <div className="space-y-5">
            <div>
              <label className="label !text-white/60">Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@gsmtraders.in"
                className="input !bg-white/5 !border-white/10 !text-white placeholder:text-white/40 focus:!border-brand-green"
              />
            </div>
            <div>
              <label className="label !text-white/60">Password</label>
              <div className="relative">
                <input
                  required
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input !bg-white/5 !border-white/10 !text-white placeholder:text-white/40 focus:!border-brand-green pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-white/60 hover:text-white"
                  aria-label="Toggle password"
                >
                  {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          {err && (
            <div className="mt-4 text-sm bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2.5 text-red-200">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full py-3.5 rounded-2xl bg-brand-green hover:bg-brand-green-dark text-sidebar-accent font-bold text-base transition disabled:opacity-70"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {!SUPABASE_CONFIGURED && (
          <p className="mt-4 max-w-md text-center text-sm text-amber-200" role="status">
            This clone is not connected to Supabase yet. Add this project’s URL and anon key as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the local environment and Vercel settings.
          </p>
        )}
        <p className="mt-8 text-sm text-white/50 text-center">
          Single-owner secure access · GSM Traders
        </p>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem('gsm_demo', '1');
            window.location.href = '/dashboard?demo=1';
          }}
          className="mt-4 text-sm text-white/60 hover:text-white underline underline-offset-2 decoration-dotted"
        >
          ↳ Try offline demo mode without customer records
        </button>
      </div>
    </div>
  );
}
