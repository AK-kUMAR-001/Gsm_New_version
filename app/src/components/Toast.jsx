import React from 'react';
import { useAppData } from '../hooks/useAppData.jsx';

export default function Toast() {
  const { toast } = useAppData();
  if (!toast) return null;
  const colors = {
    success: 'bg-emerald-500',
    error: 'bg-red-600',
    warn: 'bg-amber-500',
    info: 'bg-ink-900',
  };
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
      <div className={`${colors[toast.kind] || colors.info} text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg animate-slideUp pointer-events-auto`}>
        {toast.message}
      </div>
    </div>
  );
}
