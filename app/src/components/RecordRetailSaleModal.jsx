import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  todayIST,
  getProductEmoji,
  currencyINR,
  productSalesUnit,
} from '../lib/business.js';
import { saleStockGuidance } from '../lib/inventory.js';
import Modal from '../components/Modal.jsx';

const emptyRow = () => ({ quantity: '', rate: '' });

function makeRequestIds(products) {
  return Object.fromEntries(products.map((product) => [product.name, window.crypto.randomUUID()]));
}

export default function RecordRetailSaleModal({ open, onClose }) {
  const { activeProducts, insertRetailSale, showToast } = useAppData();
  const navigate = useNavigate();
  const [saleDate, setSaleDate] = useState(todayIST());
  const [rows, setRows] = useState({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const requestIds = useRef({});
  const savedProducts = useRef(new Set());

  useEffect(() => {
    if (!open) return;
    setSaleDate(todayIST());
    setRows(Object.fromEntries(activeProducts.map((product) => [product.name, emptyRow()])));
    setNotes('');
    setBusy(false);
    setSaveError('');
    requestIds.current = makeRequestIds(activeProducts);
    savedProducts.current = new Set();
  }, [open, activeProducts]);

  const entries = activeProducts
    .map((product) => ({
      product,
      quantity: Number(rows[product.name]?.quantity || 0),
      rate: Number(rows[product.name]?.rate || 0),
    }))
    .filter(({ quantity, rate }) => quantity > 0 || rate > 0);
  const validEntries = entries.filter(({ quantity, rate }) => quantity > 0 && rate > 0);
  const invalidEntries = entries.length !== validEntries.length;
  const total = validEntries.reduce((sum, entry) => sum + entry.quantity * entry.rate, 0);
  const hasSavedSales = savedProducts.current.size > 0;
  const canSave = validEntries.length > 0 && !invalidEntries && !busy;

  const updateRow = (productName, field, value) => {
    setRows((current) => ({
      ...current,
      [productName]: { ...current[productName], [field]: value },
    }));
    savedProducts.current.delete(productName);
    requestIds.current[productName] = window.crypto.randomUUID();
    setSaveError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setSaveError('');

    for (const { product, quantity, rate } of validEntries) {
      if (savedProducts.current.has(product.name)) continue;
      const result = await insertRetailSale({
        id: requestIds.current[product.name],
        product: product.name,
        mootais_sold: quantity,
        price_per_mootai: rate,
        sale_date: saleDate,
        notes: notes.trim() || null,
      }, { showSuccessToast: false });
      if (result.error) {
        const guidance = saleStockGuidance(result.error.message, product.name);
        setSaveError(`Sale for ${product.name} was not saved. ${result.error.message}`);
        setBusy(false);
        if (guidance) {
          const savedNames = [...savedProducts.current];
          navigate('/inventory', {
            state: {
              stockProductName: product.name,
              stockAction: guidance.action,
              stockRedirectNotice: savedNames.length
                ? `The sale for ${product.name} was not saved. Earlier retail entries for ${savedNames.join(', ')} were already saved; do not enter them again. Complete stock entry, then return to record the blocked sale.`
                : 'This sale was not saved. Complete the stock entry, then return and enter the sale again.',
            },
          });
        }
        return;
      }
      savedProducts.current.add(product.name);
    }

    showToast('Retail sales recorded', 'success');
    setBusy(false);
    onClose();
  };

  const schemaFunctionMissing = saveError.includes('inventory_record_retail_sale');

  return (
    <Modal open={open} onClose={onClose} title="Record Retail Sale" maxWidth="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="retail-sale-date">Date</label>
          <input
            id="retail-sale-date"
            type="date"
            required
            min={todayIST()}
            max={todayIST()}
            disabled={hasSavedSales}
            value={saleDate}
            onChange={(event) => {
              setSaleDate(event.target.value);
              savedProducts.current = new Set();
              requestIds.current = makeRequestIds(activeProducts);
            }}
            className="input"
          />
        </div>

        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_72px_82px] gap-2 px-2 pb-2 text-[10px] font-bold uppercase tracking-wide text-ink-500">
            <span>Retail Sale</span>
            <span className="text-center">Qty</span>
            <span className="text-center">Rate ₹</span>
          </div>
          <div className="space-y-1">
            {activeProducts.map((product) => {
              const row = rows[product.name] || emptyRow();
              const active = Number(row.quantity) > 0 || Number(row.rate) > 0;
              const alreadySaved = savedProducts.current.has(product.name);
              return (
                <div
                  key={product.id}
                  className={`grid grid-cols-[minmax(0,1fr)_72px_82px] items-center gap-2 rounded-xl px-2 py-1 ${
                    active ? 'border border-green-300 bg-green-50' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-800">
                    <span>{getProductEmoji(product.name, activeProducts)}</span>
                    <span className="min-w-0 truncate">
                      {product.name}
                      <span className="ml-1 text-[10px] font-medium text-ink-500">({productSalesUnit(product)})</span>
                    </span>
                  </span>
                  <input
                    aria-label={`${product.name} ${productSalesUnit(product)} quantity`}
                    type="number"
                    min="0"
                    step={productSalesUnit(product) === 'Kattu' ? '1' : '0.001'}
                    disabled={alreadySaved}
                    value={row.quantity}
                    onChange={(event) => updateRow(product.name, 'quantity', event.target.value)}
                    placeholder="0"
                    className="input !px-2 !py-2 text-center"
                  />
                  <input
                    aria-label={`${product.name} rate per ${productSalesUnit(product)}`}
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={alreadySaved}
                    value={row.rate}
                    onChange={(event) => updateRow(product.name, 'rate', event.target.value)}
                    placeholder="0"
                    className="input !px-2 !py-2 text-center"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="retail-sale-notes">Notes (optional)</label>
          <input
            id="retail-sale-notes"
            disabled={hasSavedSales}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              savedProducts.current = new Set();
              requestIds.current = makeRequestIds(activeProducts);
            }}
            placeholder="e.g. market rate"
            className="input"
          />
        </div>

        <div className="rounded-2xl bg-sidebar px-4 py-3 text-center text-white">
          <span className="text-xs text-white/60">SALE </span>
          <span className="font-bold">{currencyINR(total)}</span>
          <span className="ml-2 text-xs text-white/60">
            {validEntries.length} product{validEntries.length === 1 ? '' : 's'}
          </span>
        </div>

        {(saveError || (invalidEntries && entries.length > 0)) && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <p>{saveError || 'Enter both a quantity and rate for each product.'}</p>
            {saveError && (
              <>
                {schemaFunctionMissing && (
                  <p className="mt-2 text-xs">Stock controls are not active in the database yet. Apply the inventory migration before recording this sale.</p>
                )}
              </>
            )}
          </div>
        )}

        <button type="submit" disabled={!canSave} className="btn-purple w-full justify-center">
          {busy ? 'Saving…' : 'Record Sales'}
        </button>
      </form>
    </Modal>
  );
}
