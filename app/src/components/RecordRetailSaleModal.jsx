import React, { useState, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { todayIST, getProductEmoji, currencyINR } from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import { Store, IndianRupee, ChevronDown } from 'lucide-react';

export default function RecordRetailSaleModal({ open, onClose }) {
  const { activeProducts, insertRetailSale } = useAppData();
  const [product, setProduct] = useState('');
  const [mootais_sold, setMootaisSold] = useState('');
  const [price_per_mootai, setPricePerMootai] = useState('');
  const [sale_date, setSaleDate] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setProduct(activeProducts[0]?.name || '');
      setMootaisSold('');
      setPricePerMootai('');
      setSaleDate(todayIST());
      setNotes('');
      setBusy(false);
    }
  }, [open, activeProducts]);

  const total = (Number(mootais_sold) || 0) * (Number(price_per_mootai) || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!product || !mootais_sold || !price_per_mootai) return;
    setBusy(true);
    const { error } = await insertRetailSale({
      product,
      mootais_sold: Number(mootais_sold),
      price_per_mootai: Number(price_per_mootai),
      sale_date,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!error) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Retail Sale">
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
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Mootais Sold <span className="text-red-500">*</span></label>
            <input
              required
              type="number"
              min="0"
              step="1"
              value={mootais_sold}
              onChange={(e) => setMootaisSold(e.target.value)}
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
            placeholder="Walk-in customer details, etc."
            rows={2}
            className="input resize-none"
          />
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between bg-ink-50 rounded-2xl px-4 py-3">
            <span className="text-sm font-semibold text-ink-600">Total Retail Value</span>
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
            disabled={busy || !product || !mootais_sold || !price_per_mootai}
            className="btn-navy flex-1"
          >
            <Store className="w-4 h-4" />
            {busy ? 'Saving…' : 'Record Retail'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
