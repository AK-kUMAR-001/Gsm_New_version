import React, { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useAppData } from '../hooks/useAppData.jsx';
import Modal from './Modal.jsx';

export default function DeleteBuyerModal({ open, onClose, buyer, onDeleted }) {
  const { purgeBuyer } = useAppData();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (open) {
      setConfirmation('');
      setBusy(false);
      setErrorMessage('');
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    if (confirmation.trim().toLowerCase() !== 'purge' || !buyer?.id) return;

    setBusy(true);
    setErrorMessage('');
    const result = await purgeBuyer(buyer.id);
    setBusy(false);
    if (result.error) {
      setErrorMessage(result.error.message || 'Could not permanently purge this buyer.');
      return;
    }

    onClose();
    onDeleted();
  };

  const setupMissing = errorMessage.includes('purge_archived_buyer')
    || errorMessage.includes('schema cache');

  return (
    <Modal open={open} onClose={onClose} title="Permanently purge buyer">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">This permanently removes {buyer?.name || 'this buyer'} and all their sales, payments, and linked stock-sale movements from live app data.</p>
            <p className="mt-2">
              A complete backup is placed in the inaccessible database recycle bin before removal. The buyer’s transactions and stock deductions will disappear from live reports and inventory balances.
            </p>
            <p className="mt-2 font-semibold">This cannot be undone from the app. Cancel to keep this archived customer’s live history.</p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="delete-buyer-confirmation">
            Type <span className="font-bold normal-case">purge</span> to confirm
          </label>
          <input
            id="delete-buyer-confirmation"
            required
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="input"
          />
        </div>

        {errorMessage && (
          <p className="text-sm text-red-700" role="alert">
            {setupMissing
              ? 'The permanent-purge function is not installed in the database yet. No buyer data was purged. Apply the required database migrations before trying again.'
              : errorMessage}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="btn-outline flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || confirmation.trim().toLowerCase() !== 'purge'}
            className="btn-outline flex-1 justify-center border-red-300 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? 'Purging…' : 'Permanently purge'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
