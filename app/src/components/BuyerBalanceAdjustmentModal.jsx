import React, { useEffect, useState } from 'react';
import { ArrowRight, Clock3, IndianRupee, Save } from 'lucide-react';
import Modal from './Modal.jsx';

const EXACT_INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const CHANGE_DATE = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

function formatChangeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : CHANGE_DATE.format(date);
}

export default function BuyerBalanceAdjustmentModal({
  open,
  onClose,
  buyer,
  currentBalance,
  history,
  unavailableReason = '',
  onSave,
}) {
  const [newBalance, setNewBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const unchanged = newBalance !== '' && Number(newBalance) === Number(currentBalance || 0);

  useEffect(() => {
    if (open) {
      setNewBalance(Number(currentBalance || 0).toFixed(2));
      setBusy(false);
    }
  }, [open, buyer?.id, currentBalance]);

  const submit = async (event) => {
    event.preventDefault();
    if (!buyer || newBalance === '') return;
    setBusy(true);
    let result;
    try {
      result = await onSave(buyer.id, newBalance);
    } finally {
      setBusy(false);
    }
    if (!result?.error) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Update balance${buyer ? ` — ${buyer.name}` : ''}`}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-ink-50 p-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-ink-500">Current</div>
            <div className="mt-1 break-words text-base font-extrabold text-ink-900">
              {EXACT_INR.format(Number(currentBalance || 0))}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-400" />
          <div className="min-w-0">
            <label htmlFor="buyer-new-balance" className="text-xs font-bold uppercase tracking-wide text-ink-500">
              Update
            </label>
            <div className="relative mt-1">
              <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                id="buyer-new-balance"
                required
                type="number"
                min="0"
                step="0.01"
                value={newBalance}
                onChange={(event) => setNewBalance(event.target.value)}
                className="input !py-2 !pl-9 !pr-2 text-sm font-bold"
              />
            </div>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          This changes the buyer&apos;s balance only. Purchase and payment records remain unchanged,
          and the pending total recalculates automatically.
        </p>

        {unavailableReason && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {unavailableReason}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ink-800">
            <Clock3 className="h-4 w-4 text-ink-500" />
            Balance change history
          </div>
          {history.length ? (
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {[...history].reverse().map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-xl border border-ink-100 px-3 py-2 text-xs">
                  <div className="font-semibold text-ink-700">
                    Changed: {formatChangeDate(entry.created_at)}
                  </div>
                  <div className="col-span-2 text-ink-500">
                    Old: {EXACT_INR.format(Number(entry.old_balance))}
                    <span className="mx-1.5">·</span>
                    Updated: {EXACT_INR.format(Number(entry.new_balance))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-ink-50 px-3 py-3 text-sm text-ink-500">
              No balance changes recorded yet.
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-outline flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !!unavailableReason || newBalance === '' || unchanged}
            className="btn-green flex-1"
          >
            <Save className="h-4 w-4" />
            {busy ? 'Saving…' : 'Confirm update'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
