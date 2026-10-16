import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.jsx';
import { useAppData } from './hooks/useAppData.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Buyers from './pages/Buyers.jsx';
import DeletedCustomers from './pages/DeletedCustomers.jsx';
import BuyerDetail from './pages/BuyerDetail.jsx';
import Retail from './pages/Retail.jsx';
import Reports from './pages/Reports.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import AppLayout from './components/AppLayout.jsx';
import Toast from './components/Toast.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import { Loader } from 'lucide-react';

function Protected({ children }) {
  const { isAuthed, loading: authLoading } = useAuth();
  const location = useLocation();
  if (authLoading) return <Splash />;
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function Splash() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-gradient-to-br from-sidebar via-sidebar-mid to-sidebar-accent text-white">
      <div className="w-16 h-16 rounded-2xl bg-brand-green flex items-center justify-center mb-4 animate-fadeIn">
        <svg viewBox="0 0 64 64" className="w-10 h-10 text-sidebar-accent"><path fill="currentColor" d="M40 18c-8 0-14 6-14 14 0 8 6 14 14 14 2 0 4-.4 5.6-1.2C42 45 36 40 34 32c-2-8 2-14 6-14zm-2 4c-3 1-5 5-4 10 1 5 4 8 7 9-1-4-1-13-3-19z"/><path d="M28 46c7 4 14 4 18 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none"/></svg>
      </div>
      <div className="font-bold text-xl">GSM Traders</div>
      <div className="text-white/60 text-sm mt-1 flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Loading…</div>
    </div>
  );
}

function PageLoading() {
  const { loading } = useAppData();
  if (!loading) return null;
  return (
    <div className="fixed bottom-6 right-6 z-40 bg-white border border-ink-100 rounded-xl shadow-lg px-4 py-3 text-sm flex items-center gap-2 text-ink-600">
      <Loader className="w-4 h-4 animate-spin text-brand-green" /> Syncing data…
    </div>
  );
}

export default function App() {
  const { isAuthed, loading: authLoading } = useAuth();

  useEffect(() => {
    const handleEnterToNextField = (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const current = event.target;
      if (!(current instanceof HTMLInputElement) && !(current instanceof HTMLSelectElement)) return;
      if (current instanceof HTMLInputElement && ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'search', 'submit'].includes(current.type)) return;
      if (current.disabled || current.readOnly || !current.form) return;

      const fields = [...current.form.querySelectorAll(
        'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="reset"]):not([type="search"]):not([type="submit"]), select, textarea'
      )].filter((field) => (
        !field.disabled
        && !field.readOnly
        && field.getClientRects().length > 0
        && field.getAttribute('aria-hidden') !== 'true'
      ));
      const currentIndex = fields.indexOf(current);
      const next = fields[currentIndex + 1];
      if (!next) return;

      if (current instanceof HTMLInputElement) {
        event.preventDefault();
        next.focus();
      } else {
        window.setTimeout(() => {
          if (next.isConnected && !next.disabled) next.focus();
        }, 0);
      }
    };

    document.addEventListener('keydown', handleEnterToNextField);
    return () => document.removeEventListener('keydown', handleEnterToNextField);
  }, []);

  return (
    <div className="min-h-full">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><AppLayout><OfflineBanner /><Dashboard /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/dashboard" element={<Protected><AppLayout><OfflineBanner /><Dashboard /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/buyers" element={<Protected><AppLayout><OfflineBanner /><Buyers /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/buyers/deleted" element={<Protected><AppLayout><OfflineBanner /><DeletedCustomers /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/buyers/:id" element={<Protected><AppLayout><OfflineBanner /><BuyerDetail /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/retail" element={<Protected><AppLayout><OfflineBanner /><Retail /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/reports" element={<Protected><AppLayout><OfflineBanner /><Reports /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/products" element={<Protected><AppLayout><OfflineBanner /><Products /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="/inventory" element={<Protected><AppLayout><OfflineBanner /><Inventory /><PageLoading /><Toast /></AppLayout></Protected>} />
        <Route path="*" element={<Navigate to={isAuthed && !authLoading ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </div>
  );
}
