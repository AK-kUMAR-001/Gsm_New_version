import React, { useState, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { todayIST, getProductEmoji, currencyINR } from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import { Receipt, Leaf, IndianRupee } from 'lucide-react';

export default function RecordSaleModal({ open, onClose, buyerId }) {
  const { activeProducts, insertBuyerSale } = useAppData();
  const [product, setProduct] = useState('');
  const [mootais, setMootais] = useState('');
  const [price_per_mootai, setPricePerMootai] = useState('');
  const [sale_date, setSaleDate] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setProduct(activeProducts[0]?.name || '');
      setMootais('');
      setPricePerMootai('');
      setSaleDate(todayIST());
      setNotes('');
      setBusy(false);
    }
  }, [open, activeProducts]);

  const total = (Number(mootais) || 0) * (Number(price_per_mootai) || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!product || !mootais || !price_per_mootai || !buyerId) return;
    setBusy(true);
    const { error } = await insertBuyerSale({
      buyer_id: buyerId,
      product,
      mootais: Number(mootais),
      price_per_mootai: Number(price_per_mootai),
      sale_date,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!error) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Buyer Sale">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label">Product <span className="text-red-500">*</span></label>
          <div className="relative">
            <select
              required
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="input appearance-none pr-10"
            >
              {activeProducts.map((p) => (
                <option key={p.id} value={p.name}>
                  {getProductEmoji(p.name, activeProducts)} {p.name}
                </option>
              ))}
            </select>
            <ChevronDownCustom />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Mootais <span className="text-red-500">*</span></label>
            <input
              required
              type="number"
              min="0"
              step="1"
              value={mootais}
              onChange={(e) => setMootais(e.target.value)}
              placeholder="0"
              className="input"
            />
          </div>
          <div>
            <label className="label">Price / Mootai <span className="text-red-500">*</span></label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={price_per_mootai}
                onChange={(e) => setPricePerMootai(e.target.value)}
                placeholder="0"
                className="input pl-9"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Sale Date</label>
          <input
            type="date"
            value={sale_date}
            onChange={(e) => setSaleDate(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes…"
            rows={2}
            className="input resize-none"
          />
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between bg-ink-50 rounded-2xl px-4 py-3">
            <span className="text-sm font-semibold text-ink-600">Total Sale Value</span>
            <span className="text-lg font-bold text-ink-900">{currencyINR(total)}</span>
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
            disabled={busy || !product || !mootais || !price_per_mootai}
            className="btn-purple flex-1"
          >
            <Receipt className="w-4 h-4" />
            {busy ? 'Saving…' : 'Record Sale'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ChevronDownCustom() {
  return (
    <svg
      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
