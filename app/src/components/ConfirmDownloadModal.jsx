import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Modal from './Modal.jsx';

export default function ConfirmDownloadModal({ open, fileLabel, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [displayLabel, setDisplayLabel] = useState(fileLabel);

  useEffect(() => {
    if (open) {
      setError('');
      setDisplayLabel(fileLabel);
    }
    else setBusy(false);
  }, [open, fileLabel]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (downloadError) {
      setError(`Could not download ${displayLabel}: ${downloadError.message || 'Unexpected error.'}`);
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Confirm download">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Do you want to download <span className="font-bold text-ink-900">{displayLabel}</span> now?
        </p>
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-green" onClick={confirm} disabled={busy}>
            <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download now'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
