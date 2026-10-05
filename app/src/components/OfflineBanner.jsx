import React from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const { offline } = useAppData();
  if (!offline) return null;
  return (
    <div className="mx-auto mb-4 max-w-6xl">
      <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-center gap-2">
        <WifiOff className="w-4 h-4 text-amber-600" />
        <span className="font-semibold">Demo mode</span>
        <span className="text-amber-700">
          — using local backup data. Writes are disabled. Sign in to Supabase with internet access to enable live data.
        </span>
      </div>
    </div>
  );
}
