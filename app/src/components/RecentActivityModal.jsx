import React, { useEffect, useMemo, useState } from 'react';
import {
  formatDateCompact,
  currencyINR,
  productSalesUnit,
  productStockToSalesFactor,
  productStockUnit,
  saleInputUnits,
} from '../lib/business.js';
import Modal from './Modal.jsx';
import { ArrowLeft, Check, Pencil, Trash2 } from 'lucide-react';

function toForm(activity, products = []) {
  const record = activity.record;
  if (activity.type === 'PAYMENT') {
    return {
      buyer_id: record.buyer_id || '',
      amount_paid: String(record.amount_paid ?? ''),
      date: String(record.paid_at || '').slice(0, 10),
      notes: record.notes || '',
    };
  }
  const product = products.find((item) => item.name === record.product) || { name: record.product };
  const saleDate = String(record.sale_date || '').slice(0, 10);
  const salesUnit = productSalesUnit(product);
  const stockUnit = productStockUnit(product);
  const factor = productStockToSalesFactor(product);
  const savedQuantity = Number(record.mootais ?? record.mootais_sold ?? 0);
  const savedAmount = savedQuantity * Number(record.price_per_mootai ?? 0);
  const legacyOriginalUnits = saleDate < '2026-10-13';
  const showLegacyUnit = saleDate >= '2026-10-13' && saleDate <= '2026-10-15' && stockUnit !== salesUnit;
  const quantityUnit = legacyOriginalUnits || showLegacyUnit ? stockUnit : salesUnit;
  const quantity = showLegacyUnit ? savedQuantity / factor : savedQuantity;
  return {
    buyer_id: record.buyer_id || '',
    product: record.product || '',
    quantity: String(quantity),
    quantity_unit: quantityUnit,
    price: String(quantity > 0 ? savedAmount / quantity : record.price_per_mootai ?? ''),
    date: saleDate,
    notes: record.notes || '',
  };
}

export default function RecentActivityModal({
  open,
  onClose,
  activities,
  buyers,
  products,
  onSave,
  onDelete,
  initialActivity = null,
}) {
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => activities.find((activity) => `${activity.type}:${activity.id}` === selectedId) || null,
    [activities, selectedId],
  );

  useEffect(() => {
    if (!open) {
      setSelectedId('');
      setForm(null);
      setBusy(false);
      setError('');
      return;
    }
    if (initialActivity) {
      setSelectedId(`${initialActivity.type}:${initialActivity.id}`);
      setForm(toForm(initialActivity, products));
    }
  }, [open, initialActivity, products]);

  useEffect(() => {
    if (selected) setForm(toForm(selected, products));
  }, [selectedId, products]);

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || !form || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await onSave(selected, form);
      if (result?.error) setError(result.error.message || 'Could not update this record.');
      else {
        setSelectedId('');
        setForm(null);
      }
    } catch (saveError) {
      setError(`Could not update this record: ${saveError.message || 'Unexpected error.'}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || busy) return;
    const label = selected.type === 'PAYMENT' ? 'payment' : 'sale';
    if (!window.confirm(`Permanently delete this ${label}? A deleted sale will also be reversed from stock.`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await onDelete(selected);
      if (result?.error) setError(result.error.message || `Could not delete this ${label}.`);
      else {
        setSelectedId('');
        setForm(null);
      }
    } catch (deleteError) {
      setError(`Could not delete this ${label}: ${deleteError.message || 'Unexpected error.'}`);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (activity) => {
    setSelectedId(`${activity.type}:${activity.id}`);
    setForm(toForm(activity, products));
    setError('');
  };

  const selectedProduct = products.find((product) => product.name === form?.product);
  const editableSaleUnits = saleInputUnits(selectedProduct || {}).filter((unit) => unit !== 'Kg');
  const availableBuyers = buyers.some((buyer) => buyer.id === form?.buyer_id)
    ? buyers
    : [...buyers, selected?.buyer].filter(Boolean);

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Recent Activity" maxWidth="max-w-5xl">
      {selected && form ? (
        <form onSubmit={submit} className="space-y-4">
          <button
            type="button"
            onClick={() => { setSelectedId(''); setForm(null); setError(''); }}
            disabled={busy}
            className="inline-flex items-center gap-1 text-sm font-semibold text-sidebar-accent disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" /> All activity
          </button>
          <div className="rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
            Editing {selected.type === 'PAYMENT' ? 'buyer payment' : selected.type === 'RETAIL' ? 'retail sale' : 'buyer bill'} · {formatDateCompact(selected.date)}
            {selected.type !== 'PAYMENT' && <span className="mt-1 block text-xs">Saving recalculates reports and stock. The database rejects a correction if it would make stock negative.</span>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {selected.type !== 'RETAIL' && (
              <label className="label">
                Buyer
                <select name="buyer_id" required value={form.buyer_id} onChange={updateField} className="input mt-1">
                  {availableBuyers.map((buyer) => (
                    <option key={buyer.id} value={buyer.id}>
                      {buyer.archived_at ? 'Deleted user (archived)' : buyer.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected.type === 'PAYMENT' ? (
              <label className="label">
                Amount received (INR)
                <input name="amount_paid" type="number" min="0.01" step="0.01" required value={form.amount_paid} onChange={updateField} className="input mt-1" />
              </label>
            ) : (
              <>
                <label className="label">
                  Product
                  <select name="product" required value={form.product} onChange={(event) => {
                    const nextProduct = products.find((product) => product.name === event.target.value);
                    setForm((current) => ({
                      ...current,
                      product: event.target.value,
                      quantity_unit: nextProduct ? saleInputUnits(nextProduct)[0] : current.quantity_unit,
                    }));
                  }} className="input mt-1">
                    {products.map((product) => <option key={product.id} value={product.name}>{product.name}</option>)}
                  </select>
                </label>
                <label className="label">
                  Quantity
                  <input name="quantity" type="number" min="0.001" step="0.001" required value={form.quantity} onChange={updateField} className="input mt-1" />
                </label>
                <label className="label">
                  Quantity unit
                  <select name="quantity_unit" required value={form.quantity_unit || selectedProduct?.sales_unit || ''} onChange={updateField} className="input mt-1">
                    {[...editableSaleUnits, form.quantity_unit]
                      .filter((unit, index, all) => unit && unit !== 'Kg' && all.indexOf(unit) === index)
                      .map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <label className="label">
                  Price per unit (INR)
                  <input name="price" type="number" min={selected.type === 'RETAIL' ? '0.01' : '0'} step="0.000001" required value={form.price} onChange={updateField} className="input mt-1" />
                </label>
              </>
            )}
            {selected.type !== 'PAYMENT' && (
              <div className="self-end rounded-xl bg-brand-green/10 px-4 py-3 text-sm font-semibold text-brand-green-dark">
                Updated bill total: {currencyINR(Number(form.quantity || 0) * Number(form.price || 0))}
              </div>
            )}
            <label className="label">
              Date
              <input name="date" type="date" required value={form.date} onChange={updateField} className="input mt-1" />
            </label>
            <label className="label sm:col-span-2">
              Notes
              <textarea name="notes" rows={2} value={form.notes} onChange={updateField} className="input mt-1" />
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-between gap-3 border-t border-ink-100 pt-4">
            <button type="button" onClick={remove} disabled={busy} className="btn-outline text-red-700 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Delete record
            </button>
            <button type="submit" disabled={busy} className="btn-green disabled:opacity-50">
              <Check className="h-4 w-4" /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-500">Edit or remove a buyer bill, retail sale, or payment. Archived buyers appear as “Deleted user”; their recorded history remains intact.</p>
          <div className="max-h-[68vh] divide-y divide-ink-100 overflow-y-auto">
            {!activities.length && <p className="py-10 text-center text-sm text-ink-500">No activity found.</p>}
            {activities.map((activity) => (
              <div key={`${activity.type}:${activity.id}`} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-900">
                    {activity.type === 'PAYMENT' ? 'Payment' : activity.type === 'RETAIL' ? 'Retail sale' : 'Buyer sale'}
                    {activity.buyer_name ? ` · ${activity.buyer_name}` : ''}
                    {activity.product ? ` · ${activity.product}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-500">{formatDateCompact(activity.date)} · {currencyINR(activity.amount)}</div>
                </div>
                <button type="button" onClick={() => startEditing(activity)} className="btn-ghost shrink-0" aria-label={`Edit ${activity.type.toLowerCase()} record`}>
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
