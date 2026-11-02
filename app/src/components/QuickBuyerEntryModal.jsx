import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  currencyINRPerUnit,
  getProductEmoji,
  todayIST,
  saleInputUnits,
  saleQuantityInUnit,
  saleRateInUnit,
} from '../lib/business.js';
import { saleStockGuidance } from '../lib/inventory.js';
import Modal from './Modal.jsx';
import { Search } from 'lucide-react';

const emptyRow = (product) => ({
  quantity: '',
  rate: '',
  quantity_unit: saleInputUnits(product)[0],
  discount_amount: '',
});

function newRequestIds(products) {
  return Object.fromEntries(products.map((product) => [product.name, window.crypto.randomUUID()]));
}

export default function QuickBuyerEntryModal({ open, onClose, buyerId = null, initialDate = null }) {
  const {
    activeBuyers, balancesById, activeProducts, insertBuyerSale, insertPayment, showToast,
  } = useAppData();
  const navigate = useNavigate();
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [choosingBuyer, setChoosingBuyer] = useState(true);
  const [query, setQuery] = useState('');
  const [saleDate, setSaleDate] = useState(todayIST());
  const [rows, setRows] = useState({});
  const [payment, setPayment] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const requestIds = useRef({});
  const savedProducts = useRef(new Set());
  const failedPayment = useRef(false);

  const selectedBuyer = activeBuyers.find((buyer) => buyer.id === selectedBuyerId);
  const buyerBalance = balancesById[selectedBuyerId];

  useEffect(() => {
    if (!open) return;
    setSelectedBuyerId(buyerId || '');
    setChoosingBuyer(!buyerId);
    setQuery('');
    setSaleDate(initialDate || todayIST());
    setRows(Object.fromEntries(activeProducts.map((product) => [product.name, emptyRow(product)])));
    setPayment('');
    setNotes('');
    setSaving(false);
    setErrorMessage('');
    requestIds.current = newRequestIds(activeProducts);
    savedProducts.current = new Set();
    failedPayment.current = false;
  }, [open, activeProducts, buyerId, initialDate]);

  const filteredBuyers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...activeBuyers]
      .filter((buyer) => {
        if (!term) return true;
        return String(buyer.name || '').toLowerCase().includes(term)
          || String(buyer.phone || '').toLowerCase().includes(term);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [activeBuyers, query]);

  const entries = activeProducts
    .map((product) => ({
      product,
      quantity: Number(rows[product.name]?.quantity || 0),
      rate: Number(rows[product.name]?.rate || 0),
    }))
    .filter(({ quantity, rate }) => quantity > 0 || rate > 0);
  const validEntries = entries
    .filter(({ quantity, rate }) => quantity > 0 && rate > 0)
    .map((entry) => ({
      ...entry,
      original_total: Number((entry.quantity * entry.rate).toFixed(2)),
      discount_amount: rows[entry.product.name]?.discount_amount === ''
        ? 0
        : Number(rows[entry.product.name]?.discount_amount),
    }));
  const invalidEntries = entries.length !== validEntries.length;
  const invalidDiscountEntries = validEntries.some((entry) => (
    !Number.isFinite(entry.discount_amount)
      || entry.discount_amount < 0
      || entry.discount_amount > entry.original_total
  ));
  const total = validEntries.reduce((sum, entry) => (
    sum + entry.original_total - entry.discount_amount
  ), 0);
  const hasSavedSales = savedProducts.current.size > 0;
  const valid = selectedBuyerId && validEntries.length > 0 && !invalidEntries && !invalidDiscountEntries && !saving;

  const updateRow = (productName, field, value) => {
    setRows((current) => ({ ...current, [productName]: { ...current[productName], [field]: value } }));
    savedProducts.current.delete(productName);
    requestIds.current[productName] = window.crypto.randomUUID();
    setErrorMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || failedPayment.current) return;
    setSaving(true);
    setErrorMessage('');

    for (const { product, quantity, rate } of validEntries) {
      if (savedProducts.current.has(product.name)) continue;
      const result = await insertBuyerSale({
        id: requestIds.current[product.name],
        buyer_id: selectedBuyerId,
        product: product.name,
        mootais: quantity,
        quantity_unit: rows[product.name]?.quantity_unit || saleInputUnits(product)[0],
        price_per_mootai: rate,
        discounted_bill_total: rows[product.name]?.discount_amount
          ? Number((quantity * rate - Number(rows[product.name].discount_amount)).toFixed(2))
          : null,
        sale_date: saleDate,
        notes: notes.trim() || null,
      });
      if (result.error) {
        const guidance = saleStockGuidance(result.error.message, product.name);
        setErrorMessage(`Sale for ${product.name} was not saved. ${result.error.message}`);
        setSaving(false);
        if (guidance) {
          const savedNames = [...savedProducts.current];
          navigate('/inventory', {
            state: {
              stockProductName: product.name,
              stockAction: guidance.action,
              stockRedirectNotice: savedNames.length
                ? `The sale for ${product.name} was not saved. Earlier sale entries for ${savedNames.join(', ')} were already saved; do not enter them again. Complete stock entry, then return to record the blocked sale.`
                : 'This sale was not saved. Complete the stock entry, then return and enter the sale again.',
            },
          });
        }
        return;
      }
      savedProducts.current.add(product.name);
    }

    const received = Number(payment || 0);
    if (received > 0) {
      const result = await insertPayment({
        buyer_id: selectedBuyerId,
        amount_paid: received,
        paid_at: saleDate,
        notes: notes.trim() || null,
      });
      if (result.error) {
        failedPayment.current = true;
        setErrorMessage('The sale was saved, but the payment could not be confirmed. Check the buyer payment history before trying to record it again.');
        setSaving(false);
        return;
      }
    }

    showToast('Buyer entry saved', 'success');
    setSaving(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick Buyer Entry"
      maxWidth="max-w-xl"
      contentClassName="!p-3 sm:!p-4"
    >
      {choosingBuyer ? (
        <div className="space-y-4">
          <label className="label" htmlFor="quick-buyer-search">Buyer *</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              id="quick-buyer-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or phone..."
              className="input !pl-11"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-2xl border border-ink-100 divide-y divide-ink-100">
            {filteredBuyers.map((buyer) => {
              const due = Number(balancesById[buyer.id]?.balance_due || 0);
              return (
                <button
                  key={buyer.id}
                  type="button"
                  onClick={() => {
                    if (selectedBuyerId !== buyer.id) {
                      savedProducts.current = new Set();
                      requestIds.current = newRequestIds(activeProducts);
                    }
                    setSelectedBuyerId(buyer.id);
                    setChoosingBuyer(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50"
                >
                  <span className="w-10 h-10 rounded-full bg-sidebar-accent text-white flex items-center justify-center font-bold">
                    {String(buyer.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink-900">{buyer.name}</span>
                    <span className="block truncate text-xs text-ink-500">{buyer.phone || 'No phone number'}</span>
                  </span>
                  <span className={`text-xs font-bold ${due > 0 ? 'text-amber-700' : 'text-ink-500'}`}>
                    {due > 0 ? currencyINR(due) : 'No dues'}
                  </span>
                </button>
              );
            })}
            {filteredBuyers.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-500">No buyers found.</p>
            )}
          </div>
        </div>
      ) : selectedBuyer && (
        <form onSubmit={submit} className="space-y-2.5">
          <div className="flex items-center gap-2.5 rounded-2xl bg-ink-50 px-3 py-2">
            <span             className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent font-bold text-white">
              {String(selectedBuyer.name || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{selectedBuyer.name}</span>
              <span className="block text-xs text-ink-500">
                {Number(buyerBalance?.balance_due || 0) > 0 ? `${currencyINR(buyerBalance.balance_due)} due` : 'No dues'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setChoosingBuyer(true)}
              disabled={hasSavedSales}
              className="text-sm font-semibold text-sidebar-accent disabled:opacity-50"
            >
              Change
            </button>
          </div>

          <div>
            <label className="label" htmlFor="quick-sale-date">Date</label>
            <input
              id="quick-sale-date"
              type="date"
              required
              min={initialDate ? undefined : todayIST()}
              disabled={hasSavedSales}
              max={todayIST()}
              value={saleDate}
              onChange={(event) => {
                setSaleDate(event.target.value);
                savedProducts.current = new Set();
                requestIds.current = newRequestIds(activeProducts);
              }}
              className="input"
            />
          </div>

          <div>
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_68px] gap-1.5 px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-500">
              <span>Buyer Sale</span><span className="text-center">Unit</span><span className="text-center">Qty</span><span className="text-center">Rate ₹</span>
            </div>
            <div className="space-y-1">
              {activeProducts.map((product) => {
                const row = rows[product.name] || emptyRow(product);
                const active = Number(row.quantity) > 0 || Number(row.rate) > 0;
                const units = saleInputUnits(product);
                const inputUnit = row.quantity_unit || units[0];
                const otherUnit = units.find((unit) => unit !== inputUnit);
                const quantity = Number(row.quantity || 0);
                const rate = Number(row.rate || 0);
                const originalTotal = Number((quantity * rate).toFixed(2));
                const discountAmount = Number(row.discount_amount || 0);
                const discountedTotal = Math.max(0, originalTotal - discountAmount);
                const discountPercent = originalTotal > 0 ? (discountAmount / originalTotal) * 100 : 0;
                return (
                  <div key={product.id} className={`grid grid-cols-[minmax(0,1fr)_64px_64px_68px] items-center gap-1.5 rounded-xl px-2 py-0.5 ${active ? 'border border-green-300 bg-green-50' : ''}`}>
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-800">
                      <span>{getProductEmoji(product.name, activeProducts)}</span>
                      <span className="min-w-0 truncate">
                        {product.name}
                        <span className="ml-1 text-[10px] font-medium text-ink-500">({saleInputUnits(product).join(' / ')})</span>
                      </span>
                    </span>
                    <select
                      aria-label={`${product.name} sale unit`}
                      disabled={savedProducts.current.has(product.name) || units.length === 1}
                      value={inputUnit}
                      onChange={(event) => updateRow(product.name, 'quantity_unit', event.target.value)}
                      className="input !min-h-9 !px-1 !py-1.5 text-center text-xs"
                    >
                      {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                    <input
                      aria-label={`${product.name} ${inputUnit} quantity`}
                      type="number"
                      disabled={savedProducts.current.has(product.name)}
                      min="0"
                      step="0.001"
                      value={row.quantity}
                      onChange={(event) => updateRow(product.name, 'quantity', event.target.value)}
                      placeholder="0"
                      className="input !min-h-9 !px-2 !py-1.5 text-center"
                    />
                    <input
                      aria-label={`${product.name} rate per ${inputUnit}`}
                      type="number"
                      disabled={savedProducts.current.has(product.name)}
                      min="0"
                      step="0.0001"
                      value={row.rate}
                      onChange={(event) => updateRow(product.name, 'rate', event.target.value)}
                      placeholder="0"
                      className="input !min-h-9 !px-2 !py-1.5 text-center"
                    />
                    {otherUnit && quantity > 0 && rate > 0 && (
                      <p className="col-span-4 pb-1 text-right text-[11px] font-medium text-ink-500">
                        {saleQuantityInUnit(product, quantity, inputUnit, otherUnit).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {otherUnit}
                        {' · '}{currencyINRPerUnit(saleRateInUnit(product, rate, inputUnit, otherUnit))} per {otherUnit}
                      </p>
                    )}
                    {quantity > 0 && rate > 0 && (
                      <div className="col-span-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-1.5 pb-1">
                        <label className="text-[11px] font-semibold text-ink-600">
                          Original bill total (₹)
                          <input
                            aria-label={`${product.name} original bill total`}
                            type="text"
                            readOnly
                            value={currencyINR(originalTotal)}
                            className="input mt-1 !min-h-9 !cursor-not-allowed !bg-slate-50 !px-2 !py-1.5 text-xs !text-ink-500"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-ink-600">
                          Discount amount (₹) · Optional
                          <input
                            aria-label={`${product.name} discount amount`}
                            type="number"
                            disabled={savedProducts.current.has(product.name)}
                            min="0"
                            max={originalTotal.toFixed(2)}
                            step="0.01"
                            value={row.discount_amount}
                            onChange={(event) => updateRow(product.name, 'discount_amount', event.target.value)}
                            placeholder="0.00"
                            className="input mt-1 !min-h-9 !px-2 !py-1.5 text-xs"
                          />
                        </label>
                        <div className="col-span-2 text-right text-[11px] font-semibold text-ink-700">
                          {discountAmount > 0
                            ? `Discount ${currencyINR(discountAmount)} (${discountPercent.toFixed(2)}%)`
                            : 'No discount'}
                          <span className="mt-1 block text-base font-extrabold text-red-700 sm:text-lg">
                            Final: {currencyINR(discountedTotal)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="quick-buyer-notes">Notes (optional)</label>
            <input
              id="quick-buyer-notes"
              value={notes}
              disabled={hasSavedSales}
              onChange={(event) => {
                setNotes(event.target.value);
                savedProducts.current = new Set();
                requestIds.current = newRequestIds(activeProducts);
              }}
              placeholder="e.g. weekly order"
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="quick-buyer-payment">Buyer Payment — Received (₹)</label>
            <input
              id="quick-buyer-payment"
              type="number"
              min="0"
              step="0.01"
              value={payment}
              onChange={(event) => setPayment(event.target.value)}
              placeholder="0 (optional)"
              className="input"
            />
          </div>

          <div className="rounded-2xl bg-sidebar px-4 py-2.5 text-center text-white">
            <span className="text-xs text-white/60">FINAL SALE </span>
            <span className="font-bold">{currencyINR(total)}</span>
            <span className="ml-2 text-xs text-white/60">{validEntries.length} product{validEntries.length === 1 ? '' : 's'}</span>
          </div>

          {(errorMessage || invalidDiscountEntries || (invalidEntries && entries.length > 0)) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p>{errorMessage || (invalidDiscountEntries
                ? 'A discount amount must be between zero and that product’s original bill total.'
                : 'For each product, enter both quantity and rate, or leave both as zero.')}</p>
            </div>
          )}

          <button type="submit" disabled={!valid || failedPayment.current} className="btn-navy w-full justify-center">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {failedPayment.current && (
            <button type="button" onClick={onClose} className="btn-outline w-full justify-center">
              Close — record payment separately
            </button>
          )}
          <p className="text-center text-[11px] text-ink-400">Enter the sale quantities and rates. Payment is optional.</p>
        </form>
      )}
    </Modal>
  );
}
