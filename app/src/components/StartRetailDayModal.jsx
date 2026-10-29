import React, { useEffect, useMemo, useState } from 'react';
import { currencyINR, productSalesUnit, getProductEmoji } from '../lib/business.js';
import Modal from './Modal.jsx';

export default function StartRetailDayModal({
  open,
  onClose,
  products,
  stockByProduct,
  stockCostByProduct,
  onStart,
  busy,
  error,
}) {
  const [rates, setRates] = useState({});

  useEffect(() => {
    if (open) setRates(Object.fromEntries(products.map((product) => [product.id, ''])));
  }, [open, products]);

  const productValues = useMemo(
    () => products.map((product) => {
      const balance = stockByProduct.get(product.id) || 0;
      const value = balance * Number(rates[product.id] || 0);
      const hasCost = balance === 0 || stockCostByProduct.has(product.id);
      return {
        product,
        value,
        estimatedProfit: hasCost ? value - (stockCostByProduct.get(product.id) || 0) : null,
      };
    }),
    [products, rates, stockByProduct, stockCostByProduct],
  );
  const totalAtCurrentBalance = productValues.reduce((sum, item) => sum + item.value, 0);
  const estimatedProfitAvailable = productValues.every((item) => item.estimatedProfit != null);
  const estimatedProfitAtCurrentBalance = productValues.reduce(
    (sum, item) => sum + (item.estimatedProfit || 0),
    0,
  );

  const submit = async (event) => {
    event.preventDefault();
    await onStart(products.map((product) => ({
      product_id: product.id,
      quantity_unit: productSalesUnit(product),
      price_per_unit: Number(rates[product.id]),
    })));
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Start Retail Sales" maxWidth="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-600">
          Set today’s retail price for each active stock item. After starting, the stock left after buyer and recorded
          retail sales is counted as an automatic bulk retail sale at these prices. New buyer sales recalculate it.
        </p>

        <div className="space-y-2">
          {products.map((product) => {
            const unit = productSalesUnit(product);
            const balance = stockByProduct.get(product.id) || 0;
            return (
              <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-ink-100 bg-ink-50 p-3 sm:grid-cols-[minmax(0,1fr)_120px_150px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-ink-800">
                    <span>{getProductEmoji(product.name, products)}</span>
                    <span className="truncate">{product.name}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-500">Automatic retail sale quantity: {balance.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {unit}</div>
                </div>
                <div className="hidden text-right text-xs font-semibold text-ink-500 sm:block">Unit: {unit}</div>
                <label className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink-600 sm:hidden">₹</span>
                  <input
                    aria-label={`${product.name} retail price per ${unit}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    disabled={busy}
                    value={rates[product.id] ?? ''}
                    onChange={(event) => setRates((current) => ({ ...current, [product.id]: event.target.value }))}
                    placeholder={`₹ / ${unit}`}
                    className="input min-w-0"
                  />
                </label>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl bg-sidebar px-4 py-3 text-white">
          <div className="text-center text-xs text-white/60">Automatic retail sale revenue</div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
            {productValues.map(({ product, value }, index) => (
              <React.Fragment key={product.id}>
                {index > 0 && <span className="text-white/60">+</span>}
                <span className="font-semibold">{product.name} {currencyINR(value)}</span>
              </React.Fragment>
            ))}
            <span className="text-white/60">=</span>
            <span className="font-extrabold">{currencyINR(totalAtCurrentBalance)}</span>
          </div>
          <div className="mt-3 text-center text-xs text-white/60">Profit on automatic retail sale</div>
          <div className="mt-1 text-center text-lg font-extrabold">
            {estimatedProfitAvailable ? currencyINR(estimatedProfitAtCurrentBalance) : 'Unavailable: stock cost is missing'}
          </div>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Buyer sales entered after starting reduce the automatic retail sale quantity and update its revenue and profit.
          No separate retail transaction entry is needed for this remaining stock.
        </div>

        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}

        <button type="submit" disabled={busy || products.length === 0} className="btn-green w-full justify-center">
          {busy ? 'Starting…' : 'Start Retail Sales'}
        </button>
      </form>
    </Modal>
  );
}
