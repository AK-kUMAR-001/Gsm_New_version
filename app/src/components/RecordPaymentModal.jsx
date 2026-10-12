import React, { useState, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { todayIST, currencyINR } from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import { HandCoins, IndianRupee } from 'lucide-react';

export default function RecordPaymentModal({ open, onClose, buyerId }) {
  const { insertPayment } = useAppData();
  const [amount_paid, setAmountPaid] = useState('');
  const [paid_at, setPaidAt] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAmountPaid('');
      setPaidAt(todayIST());
      setNotes('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!amount_paid || !buyerId) return;
    setBusy(true);
    const { error } = await insertPayment({
      buyer_id: buyerId,
      amount_paid: Number(amount_paid),
      paid_at,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!error) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Payment">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label">Amount Paid (INR) <span className="text-red-500">*</span></label>
          <div className="relative">
            <IndianRupee className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount_paid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="0"
              className="input pl-11"
            />
          </div>
        </div>

        <div>
          <label className="label">Paid On</label>
          <input
            type="date"
            value={paid_at}
            onChange={(e) => setPaidAt(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Cash, UPI, bank transfer, etc."
            rows={2}
            className="input resize-none"
          />
        </div>

        {amount_paid && Number(amount_paid) > 0 && (
          <div className="flex items-center justify-between bg-brand-green/10 border border-brand-green/20 rounded-2xl px-4 py-3">
            <span className="text-sm font-semibold text-ink-700">Payment Amount</span>
            <span className="text-lg font-bold text-ink-900">{currencyINR(amount_paid)}</span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-outline flex-1"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !amount_paid}
            className="btn-green flex-1"
          >
            <HandCoins className="w-4 h-4" />
            {busy ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
