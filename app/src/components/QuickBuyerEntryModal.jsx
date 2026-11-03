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
import BusinessDayLeaveControl from './BusinessDayLeaveControl.jsx';
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

export default function QuickBuyerEntryModal({
  open,
  onClose,
  buyerId = null,
  initialDate = null,
  dailyWorkflow = false,
}) {
  const {
    activeBuyers,
    balancesById,
    activeProducts,
    buyerSales,
    insertBuyerSale,
    insertPayment,
    completeBusinessDayBuyer,
    showToast,
  } = useAppData();
  const navigate = useNavigate();
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [choosingBuyer, setChoosingBuyer] = useState(true);
  const [query, setQuery] = useState('');
  const [saleDate, setSaleDate] = useState(todayIST());
  const [rows, setRows] = useState({});
  const [discountMode, setDiscountMode] = useState('choose');
  const [payment, setPayment] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [needsDailyCompletion, setNeedsDailyCompletion] = useState(false);
  const requestIds = useRef({});
  const savedProducts = useRef(new Set());
  const failedPayment = useRef(false);

  const selectedBuyer = activeBuyers.find((buyer) => buyer.id === selectedBuyerId);
  const buyerBalance = balancesById[selectedBuyerId];
  const existingBuyerDaySales = buyerSales.filter((sale) => (
    sale.buyer_id === selectedBuyerId && String(sale.sale_date || '').slice(0, 10) === saleDate
  ));

  useEffect(() => {
    if (!open) return;
    setSelectedBuyerId(buyerId || '');
    setChoosingBuyer(!buyerId);
    setQuery('');
    setSaleDate(initialDate || todayIST());
    setRows(Object.fromEntries(activeProducts.map((product) => [product.name, emptyRow(product)])));
    setDiscountMode('choose');
    setPayment('');
    setNotes('');
    setSaving(false);
    setErrorMessage('');
    setNeedsDailyCompletion(false);
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
  const discountTotal = validEntries.reduce((sum, entry) => sum + entry.discount_amount, 0);
  const discountPercent = validEntries.reduce((sum, entry) => sum + entry.original_total, 0) > 0
    ? (discountTotal / validEntries.reduce((sum, entry) => sum + entry.original_total, 0)) * 100
    : 0;
  const invalidDiscountEntries = ['editing', 'confirmed'].includes(discountMode) && validEntries.some((entry) => (
    !Number.isFinite(entry.discount_amount)
      || entry.discount_amount < 0
      || entry.discount_amount > entry.original_total
  ));
  const discountsApplied = ['editing', 'confirmed'].includes(discountMode);
  const total = validEntries.reduce((sum, entry) => (
    sum + entry.original_total - (discountsApplied ? entry.discount_amount : 0)
  ), 0);
  const hasSavedSales = savedProducts.current.size > 0;
  const valid = selectedBuyerId
    && validEntries.length > 0
    && !invalidEntries
    && !invalidDiscountEntries
    && !['choose', 'editing'].includes(discountMode)
    && !saving;

  const markDailyBuyerComplete = async (status) => {
    if (!dailyWorkflow || !selectedBuyerId || saving) return;
    if (status === 'no_sale' && entries.length > 0) {
      setErrorMessage('Remove the sale quantities before marking this buyer as no sale.');
      return;
    }
    const paymentAmount = Number(payment);
    if (payment.trim() && (!Number.isFinite(paymentAmount) || paymentAmount < 0)) {
      setErrorMessage('Enter a valid non-negative payment amount.');
      return;
    }
    setSaving(true);
    setErrorMessage('');
    if (paymentAmount > 0) {
      const paymentResult = await insertPayment({
        buyer_id: selectedBuyerId,
        amount_paid: paymentAmount,
        paid_at: saleDate,
        notes: notes.trim() || null,
      });
      if (paymentResult.error) {
        setSaving(false);
        setErrorMessage(`Payment was not saved: ${paymentResult.error.message}`);
        return;
      }
      setPayment('');
    }
    const result = await completeBusinessDayBuyer(saleDate, selectedBuyerId, status);
    setSaving(false);
    if (result.error) {
      setErrorMessage(`Could not mark ${selectedBuyer?.name || 'this buyer'} complete: ${result.error.message}`);
      return;
    }
    onClose();
  };

  const updateRow = (productName, field, value) => {
    setRows((current) => {
      if (field === 'discount_amount') {
        return { ...current, [productName]: { ...current[productName], [field]: value } };
      }
      return Object.fromEntries(Object.entries(current).map(([name, row]) => [
        name,
        { ...row, [field]: name === productName ? value : row[field], discount_amount: '' },
      ]));
    });
    if (field !== 'discount_amount') setDiscountMode('choose');
    savedProducts.current.delete(productName);
    requestIds.current[productName] = window.crypto.randomUUID();
    setErrorMessage('');
  };

  const skipDiscount = () => {
    setRows((current) => Object.fromEntries(Object.entries(current).map(([name, row]) => [
      name,
      { ...row, discount_amount: '' },
    ])));
    setDiscountMode('without');
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
        discounted_bill_total: discountMode === 'confirmed' && rows[product.name]?.discount_amount
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
      setPayment('');
    }

    if (dailyWorkflow) {
      const progress = await completeBusinessDayBuyer(saleDate, selectedBuyerId, 'sales_recorded');
      if (progress.error) {
        setNeedsDailyCompletion(true);
        setErrorMessage(`Sale saved, but buyer completion could not be recorded. Do not enter the sale again. Retry completion: ${progress.error.message}`);
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
      title={dailyWorkflow ? 'Daily Buyer Entry' : 'Quick Buyer Entry'}
      maxWidth="max-w-lg"
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
            {!dailyWorkflow && <button
              type="button"
              onClick={() => setChoosingBuyer(true)}
              disabled={hasSavedSales}
              className="text-sm font-semibold text-sidebar-accent disabled:opacity-50"
            >
              Change
            </button>}
          </div>

          {dailyWorkflow && existingBuyerDaySales.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              {existingBuyerDaySales.length} sale line{existingBuyerDaySales.length === 1 ? '' : 's'} already exist for
              {' '}{saleDate}. Review the entries, then mark this buyer complete if their sales are finished.
            </div>
          )}

          <div>
            <label className="label" htmlFor="quick-sale-date">Date</label>
            <input
              id="quick-sale-date"
              type="date"
              required
              min={dailyWorkflow || initialDate ? undefined : todayIST()}
              disabled={dailyWorkflow || hasSavedSales}
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
          {dailyWorkflow && (
            <div className="flex justify-end">
              <BusinessDayLeaveControl date={saleDate} onMarked={onClose} inline />
            </div>
          )}

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
                  </div>
                );
              })}
            </div>
          </div>

          {validEntries.length > 0 && !invalidEntries && (
            <section className="rounded-xl border border-ink-200 bg-ink-50 p-3" aria-label="Discount options">
              {discountMode === 'choose' && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-ink-700">Add a discount to this sale?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDiscountMode('editing')}
                      className="btn-outline flex-1 justify-center !px-3 !py-2 sm:flex-none"
                    >
                      Add discount
                    </button>
                    <button
                      type="button"
                      onClick={skipDiscount}
                      className="btn-outline flex-1 justify-center !px-3 !py-2 sm:flex-none"
                    >
                      Without discount
                    </button>
                  </div>
                </div>
              )}
              {discountMode === 'editing' && (
                <div className="space-y-2">
                  <div>
                    <h4 className="text-sm font-bold text-ink-800">Apply discount</h4>
                    <p className="text-xs text-ink-500">Enter an amount for each item; percentage and final amount update automatically.</p>
                  </div>
                  <div className="max-h-52 space-y-2 overflow-y-auto overscroll-contain pr-1">
                    {validEntries.map(({ product, quantity, rate, original_total: originalTotal, discount_amount: discountAmount }) => {
                      const row = rows[product.name] || emptyRow(product);
                      const finalAmount = Math.max(0, originalTotal - discountAmount);
                      const itemDiscountPercent = originalTotal > 0 ? (discountAmount / originalTotal) * 100 : 0;
                      return (
                        <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,112px)] items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-ink-800">{product.name}</p>
                            <p className="text-xs text-ink-500">
                              {quantity} × {currencyINR(rate)} = {currencyINR(originalTotal)}
                            </p>
                            <p className="text-sm font-extrabold text-red-700">
                              {itemDiscountPercent.toFixed(2)}% discount · Final {currencyINR(finalAmount)}
                            </p>
                          </div>
                          <label className="text-[10px] font-bold uppercase text-ink-500">
                            Discount ₹
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
                              className="input mt-1 !min-h-9 !px-2 !py-1.5 text-sm"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {invalidDiscountEntries && (
                    <p className="text-xs font-semibold text-red-700" role="alert">
                      Each discount must be between zero and that item’s original amount.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-700">
                      Total discount: {currencyINR(discountTotal)} ({discountPercent.toFixed(2)}%)
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={skipDiscount} className="btn-outline !px-3 !py-2">
                        Without discount
                      </button>
                      <button
                        type="button"
                        disabled={invalidDiscountEntries || saving}
                        onClick={() => setDiscountMode('confirmed')}
                        className="btn-navy !px-3 !py-2"
                      >
                        Confirm discount
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {discountMode === 'confirmed' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    {validEntries.map(({ product, quantity, rate, original_total: originalTotal, discount_amount: discountAmount }) => {
                      const finalAmount = Math.max(0, originalTotal - discountAmount);
                      const itemDiscountPercent = originalTotal > 0 ? (discountAmount / originalTotal) * 100 : 0;
                      return (
                        <div key={product.id} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-white px-3 py-1.5 text-xs">
                          <span className="font-semibold text-ink-700">
                            {product.name}: {quantity} × {currencyINR(rate)} · Original {currencyINR(originalTotal)} · Discount {currencyINR(discountAmount)} ({itemDiscountPercent.toFixed(2)}%)
                          </span>
                          <span className="font-extrabold text-red-700">Final {currencyINR(finalAmount)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-700">
                      Discount confirmed: {currencyINR(discountTotal)} ({discountPercent.toFixed(2)}%)
                    </p>
                    <button
                      type="button"
                      onClick={() => setDiscountMode('editing')}
                      className="text-sm font-bold text-sidebar-accent hover:underline"
                    >
                      Edit discount
                    </button>
                  </div>
                </div>
              )}
              {discountMode === 'without' && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-700">Sale without discount</p>
                  <button
                    type="button"
                    onClick={() => setDiscountMode('choose')}
                    className="text-sm font-bold text-sidebar-accent hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
            </section>
          )}

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

          {dailyWorkflow && (
            <div className="grid gap-2 sm:grid-cols-2">
              {existingBuyerDaySales.length > 0 && (
                <button
                  type="button"
                  onClick={() => markDailyBuyerComplete('sales_recorded')}
                  disabled={saving}
                  className="btn-outline justify-center"
                >
                  {needsDailyCompletion ? 'Retry completion' : 'Sales done — next buyer'}
                </button>
              )}
              {existingBuyerDaySales.length === 0 && (
                <button
                  type="button"
                  onClick={() => markDailyBuyerComplete('no_sale')}
                  disabled={saving || entries.length > 0}
                  className="btn-outline justify-center border-red-200 text-red-700 hover:bg-red-50"
                >
                  No sale — continue to next customer
                </button>
              )}
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
