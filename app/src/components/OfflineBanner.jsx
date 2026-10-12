import React from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const { offline, dataLoadError, load } = useAppData();
  if (!offline) return null;
  return (
    <div className="mx-auto mb-4 max-w-6xl">
      <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-center gap-2">
        <WifiOff className="w-4 h-4 text-amber-600" />
        <span className="font-semibold">Offline</span>
        <span className="text-amber-700 flex-1 min-w-0">
          {dataLoadError
            ? `— ${dataLoadError} No business data is available and writes are disabled.`
            : '— the database connection is unavailable. No business data is available and writes are disabled.'}
        </span>
        {dataLoadError && (
          <button type="button" onClick={load} className="ml-auto font-semibold underline underline-offset-2">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
