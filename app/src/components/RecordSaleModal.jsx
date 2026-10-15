import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { todayIST, getProductEmoji, currencyINR, productSalesUnit } from '../lib/business.js';
import { saleStockGuidance } from '../lib/inventory.js';
import Modal from '../components/Modal.jsx';
import { Receipt, IndianRupee } from 'lucide-react';

export default function RecordSaleModal({ open, onClose, buyerId }) {
  const { activeProducts, insertBuyerSale, insertPayment } = useAppData();
  const navigate = useNavigate();
  const [product, setProduct] = useState('');
  const [mootais, setMootais] = useState('');
  const [price_per_mootai, setPricePerMootai] = useState('');
  const [payment, setPayment] = useState('');
  const [sale_date, setSaleDate] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const requestId = useRef(null);
  const failedPayment = useRef(false);

  useEffect(() => {
    if (open) {
      requestId.current = window.crypto.randomUUID();
      setProduct(activeProducts[0]?.name || '');
      setMootais('');
      setPricePerMootai('');
      setPayment('');
      setSaleDate(todayIST());
      setNotes('');
      setBusy(false);
      setSaveError('');
      failedPayment.current = false;
    }
  }, [open, activeProducts]);

  const total = (Number(mootais) || 0) * (Number(price_per_mootai) || 0);
  const stockGuidance = saleStockGuidance(saveError, product);
  const selectedProduct = activeProducts.find((item) => item.name === product);
  const salesUnit = productSalesUnit(selectedProduct);

  const submit = async (e) => {
    e.preventDefault();
    if (!product || !mootais || !price_per_mootai || !buyerId || failedPayment.current) return;
    setBusy(true);
    const { error } = await insertBuyerSale({
      id: requestId.current,
      buyer_id: buyerId,
      product,
      mootais: Number(mootais),
      price_per_mootai: Number(price_per_mootai),
      sale_date,
      notes: notes.trim() || null,
    });
    if (error) {
      const guidance = saleStockGuidance(error.message, product);
      setBusy(false);
      setSaveError(error.message || 'The sale could not be saved.');
      if (guidance) {
        navigate('/inventory', {
          state: {
            stockProductName: product,
            stockAction: guidance.action,
            stockRedirectNotice: 'This sale was not saved. Complete the stock entry, then return and enter the sale again.',
          },
        });
      }
      return;
    }

    const amountReceived = Number(payment || 0);
    if (amountReceived > 0) {
      const paymentResult = await insertPayment({
        buyer_id: buyerId,
        amount_paid: amountReceived,
        paid_at: sale_date,
        notes: notes.trim() || null,
      });
      if (paymentResult.error) {
        failedPayment.current = true;
        setSaveError('The sale was saved, but the payment could not be confirmed. Check the buyer payment history before recording it again.');
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    requestId.current = null;
    onClose();
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
            <label className="label">Quantity ({salesUnit}) <span className="text-red-500">*</span></label>
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              value={mootais}
              onChange={(e) => setMootais(e.target.value)}
              placeholder="0"
              className="input"
            />
          </div>
          <div>
            <label className="label">Price / {salesUnit} <span className="text-red-500">*</span></label>
            <div className="relative">
              <IndianRupee className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={price_per_mootai}
                onChange={(e) => setPricePerMootai(e.target.value)}
                placeholder="0"
                className="input pl-11"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Sale Date</label>
          <input
            type="date"
            value={sale_date}
            min={todayIST()}
            max={todayIST()}
            onChange={(e) => setSaleDate(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label" htmlFor="buyer-sale-payment">Buyer Payment — Received (₹)</label>
          <input
            id="buyer-sale-payment"
            type="number"
            min="0"
            step="0.01"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            placeholder="0 (optional)"
            className="input"
          />
          <p className="mt-1 text-xs text-ink-500">Leave at 0 if the buyer will pay later.</p>
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

        {saveError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p>{stockGuidance?.message || (saveError.includes('inventory_record_buyer_sale')
              ? 'Stock controls are not active in the database yet. Apply the inventory migration before recording this sale.'
              : saveError)}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-outline flex-1"
          >
            {failedPayment.current ? 'Close — record payment separately' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={busy || !product || !mootais || !price_per_mootai || failedPayment.current}
            className="btn-purple flex-1"
          >
            <Receipt className="w-4 h-4" />
            {busy ? 'Saving…' : payment && Number(payment) > 0 ? 'Record Sale & Payment' : 'Record Sale'}
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
