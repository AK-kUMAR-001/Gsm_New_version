import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact, getProductEmoji, todayIST } from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import LowStockAlerts from '../components/LowStockAlerts.jsx';
import { AlertTriangle, Check, ClipboardCheck, PackagePlus, RefreshCw } from 'lucide-react';

const ACTION_LABELS = {
  opening: 'Enter opening stock',
  count: 'Record morning count',
  receipt: 'Add extra stock',
  damaged: 'Record damaged stock',
  correction: 'Correct stock',
};

function Quantity({ value }) {
  return <>{Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} Mootai</>;
}

function LowStockThreshold({ productId, value, onSave, disabled }) {
  const [threshold, setThreshold] = useState(String(value ?? 5));
  const [saving, setSaving] = useState(false);

  useEffect(() => setThreshold(String(value ?? 5)), [value]);

  const submit = async (event) => {
    event.preventDefault();
    if (threshold === '' || !Number.isFinite(Number(threshold)) || Number(threshold) < 0) return;
    setSaving(true);
    await onSave(Number(threshold));
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-ink-100 bg-white p-3">
      <div className="min-w-[130px] flex-1">
        <label className="label mb-1" htmlFor={`low-stock-${productId}`}>Warn at or below (Mootai)</label>
        <input
          id={`low-stock-${productId}`}
          type="number"
          min="0"
          step="0.001"
          required
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          className="input !min-h-10 !py-2"
        />
      </div>
      <button type="submit" disabled={disabled || saving} className="btn-outline !min-h-10 !px-3 !py-2">
        <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save warning'}
      </button>
      <p className="w-full text-xs text-ink-500">Set 0 to turn off this warning.</p>
    </form>
  );
}

export default function Inventory() {
  const {
    products, suppliers, inventorySettings, inventorySummary, inventoryCounts,
    inventoryMovements, inventoryLoading, inventoryError, loadInventory,
    startInventoryTracking, recordMorningCount, recordStockReceipt, recordStockAdjustment,
    updateInventoryLowStockThreshold,
    offline,
  } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [action, setAction] = useState(null);
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [redirectNotice, setRedirectNotice] = useState('');
  const requestId = useRef(null);
  const damageRequestId = useRef(null);
  const handledRedirectKey = useRef('');

  useEffect(() => {
    let active = true;
    loadInventory().finally(() => {
      if (active) setInventoryReady(true);
    });
    return () => {
      active = false;
    };
  }, [loadInventory]);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const suppliersById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const settingsById = useMemo(() => new Map(inventorySettings.map((setting) => [setting.product_id, setting])), [inventorySettings]);
  const summaryById = useMemo(() => new Map(inventorySummary.map((row) => [row.product_id, row])), [inventorySummary]);
  const countedIds = useMemo(() => new Set(
    inventoryCounts.filter((count) => count.stock_date === todayIST()).map((count) => count.product_id)
  ), [inventoryCounts]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const targetName = location.state?.stockProductName || searchParams.get('stockProductName');
    if (!targetName || !inventoryReady || inventoryError || !products.length ||
      handledRedirectKey.current === location.key) return;
    const target = products.find((item) => item.name === targetName);
    if (!target) return;

    handledRedirectKey.current = location.key;
    const isTracked = settingsById.has(target.id);
    const requestedAction = location.state?.stockAction || searchParams.get('stockAction');
    setAction(['opening', 'count', 'receipt', 'damaged'].includes(requestedAction)
      ? requestedAction
      : isTracked ? (countedIds.has(target.id) ? 'receipt' : 'count') : 'opening');
    setRedirectNotice(location.state?.stockRedirectNotice || '');
    setProductId(target.id);
    requestId.current = window.crypto.randomUUID();
    damageRequestId.current = window.crypto.randomUUID();
    setForm({
      quantity: '', unitCost: '', supplierId: '', reason: '', notes: '',
      damagedQuantity: '', damageReason: '',
    });
    searchParams.delete('stockProductName');
    searchParams.delete('stockAction');
    const remainingQuery = searchParams.toString();
    navigate({
      pathname: location.pathname,
      search: remainingQuery ? `?${remainingQuery}` : '',
    }, { replace: true, state: null });
  }, [countedIds, inventoryError, inventoryReady, location.key, location.pathname, location.search, location.state, navigate, products, settingsById]);

  const openAction = (nextAction, product) => {
    setAction(nextAction);
    setProductId(product.id);
    setRedirectNotice('');
    requestId.current = window.crypto.randomUUID();
    damageRequestId.current = window.crypto.randomUUID();
    setForm({
      quantity: '', unitCost: '', supplierId: '', reason: '', notes: '',
      damagedQuantity: '', damageReason: '',
    });
  };
  const closeAction = () => {
    setAction(null);
    setProductId('');
    setForm({});
    setRedirectNotice('');
    requestId.current = null;
    damageRequestId.current = null;
  };

  const submitAction = async (event) => {
    event.preventDefault();
    if (!action || !productId) return;
    setSaving(true);
    const quantity = Number(form.quantity);
    const damagedQuantity = Number(form.damagedQuantity || 0);
    let result;
    if (action === 'opening') {
      result = await startInventoryTracking(
        productId,
        quantity,
        form.unitCost ? Number(form.unitCost) : null,
        damagedQuantity,
        form.damageReason.trim() || null,
        damageRequestId.current,
      );
    } else if (action === 'count') {
      result = await recordMorningCount(productId, quantity, form.unitCost ? Number(form.unitCost) : null);
    } else if (action === 'receipt') {
      result = await recordStockReceipt(
        productId, form.supplierId, quantity, Number(form.unitCost),
        form.notes.trim() || null, requestId.current,
        damagedQuantity, form.damageReason.trim() || null, damageRequestId.current,
      );
    } else if (action === 'damaged') {
      result = await recordStockAdjustment(productId, 'spoilage', -quantity, form.reason.trim(), null, requestId.current);
    } else {
      result = await recordStockAdjustment(
        productId,
        'correction',
        Number(form.quantity),
        form.reason.trim(),
        form.unitCost ? Number(form.unitCost) : null,
        requestId.current,
      );
    }
    setSaving(false);
    if (!result?.error) closeAction();
  };

  const product = productsById.get(productId);
  const quantityInput = Number(form.quantity || 0);
  const damagedQuantity = Number(form.damagedQuantity || 0);
  const movements = [...inventoryMovements].sort((a, b) => (
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  ));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="page-title font-extrabold">Daily Stock In</h1>
        </div>
        <button type="button" onClick={loadInventory} disabled={inventoryLoading} className="btn-outline self-start sm:self-auto">
          <RefreshCw className={`w-4 h-4 ${inventoryLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {(offline || inventoryError) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Stock tracking is not available yet</p>
            <p className="mt-1">{offline
              ? 'Sign in to the live database and apply the documented v0.2 migration before using inventory.'
              : inventoryError}</p>
          </div>
        </div>
      )}

      <LowStockAlerts />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {products.map((item) => {
          const isTracked = settingsById.has(item.id);
          const stock = summaryById.get(item.id);
          const hasCount = countedIds.has(item.id);
          return (
            <article key={item.id} className="metric-card space-y-4">
              <header className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-ink-50 flex items-center justify-center text-2xl shrink-0">
                    {getProductEmoji(item.name, products)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-bold text-ink-900 truncate">{item.name}</h2>
                    <p className={`text-xs mt-0.5 ${isTracked ? 'text-green-700' : 'text-ink-500'}`}>
                      {isTracked ? 'Stock tracking enabled' : 'Tracking not started'}
                    </p>
                  </div>
                </div>
                {isTracked && (
                  <span className={`pill shrink-0 ${hasCount ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {hasCount ? 'Count complete' : 'Count required'}
                  </span>
                )}
              </header>

              {isTracked ? (
                <>
                  <div className="rounded-2xl bg-ink-50 p-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-ink-500">Available</p>
                      <p className="font-bold text-ink-900 mt-1"><Quantity value={stock?.quantity_on_hand} /></p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-500">Average cost / Mootai</p>
                      <p className="font-bold text-ink-900 mt-1">
                        {stock?.average_unit_cost == null ? '—' : currencyINR(stock.average_unit_cost)}
                      </p>
                    </div>
                  </div>
                  <LowStockThreshold
                    productId={item.id}
                    value={settingsById.get(item.id)?.low_stock_threshold}
                    onSave={(threshold) => updateInventoryLowStockThreshold(item.id, threshold)}
                    disabled={offline}
                  />
                  <div className="flex flex-wrap gap-2">
                    {!hasCount && (
                      <button type="button" onClick={() => openAction('count', item)} className="btn-navy">
                        <ClipboardCheck className="w-4 h-4" /> Morning count
                      </button>
                    )}
                    <button type="button" onClick={() => openAction('receipt', item)} className="btn-outline">
                      <PackagePlus className="w-4 h-4" /> Add extra stock
                    </button>
                    <button type="button" onClick={() => openAction('damaged', item)} className="btn-outline">
                      <AlertTriangle className="w-4 h-4" /> Damaged stock
                    </button>
                    <button type="button" onClick={() => openAction('correction', item)} className="btn-outline">
                      Correct stock
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-ink-600">Enter the agreed physical opening count to begin. Opening unit cost is marked as an estimate.</p>
                  <p className="text-xs text-ink-500">
                    Enter opening stock to enable sales. You can record damage on arrival here or record it later.
                  </p>
                  <button type="button" onClick={() => openAction('opening', item)} className="btn-navy">
                    <PackagePlus className="w-4 h-4" /> Enter opening stock
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="metric-card !p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-bold text-ink-900">Recent stock movements</h2>
          <p className="text-xs text-ink-500 mt-1">The stock balance is calculated from this ledger.</p>
        </div>
        {movements.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-ink-500 text-left">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-5 py-3 font-semibold">Movement</th>
                  <th className="px-5 py-3 font-semibold text-right">Quantity</th>
                  <th className="px-5 py-3 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-5 py-3 whitespace-nowrap">{formatDateCompact(movement.movement_date)}</td>
                    <td className="px-5 py-3">{productsById.get(movement.product_id)?.name || 'Product'}</td>
                    <td className="px-5 py-3 capitalize">{movement.movement_type === 'spoilage' ? 'Damaged stock' : movement.movement_type.replaceAll('_', ' ')}</td>
                    <td className={`px-5 py-3 text-right whitespace-nowrap font-semibold ${Number(movement.quantity_delta) < 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {Number(movement.quantity_delta) > 0 ? '+' : ''}<Quantity value={movement.quantity_delta} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {movement.supplier_id ? suppliersById.get(movement.supplier_id)?.name || 'Supplier' : movement.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            {inventoryLoading ? 'Loading stock movements…' : 'No stock movements yet.'}
          </p>
        )}
      </section>

      <Modal open={!!action} onClose={closeAction} title={action ? ACTION_LABELS[action] : ''}>
        {product && action && (
          <form onSubmit={submitAction} className="space-y-4">
            <p className="text-sm text-ink-600">{getProductEmoji(product.name, products)} {product.name}</p>
            {redirectNotice && (
              <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status">
                {redirectNotice}
              </p>
            )}
            {action === 'correction' && (
              <p className="text-xs text-ink-500">Use a positive quantity to add stock or a negative quantity to remove it.</p>
            )}
            {action === 'opening' && (
              <p className="text-xs text-ink-500">
                Enter the quantity received. This also records today’s opening physical count.
              </p>
            )}
            {action === 'receipt' && (
              <p className="text-xs text-ink-500">
                Add more stock to the current balance. Sales can resume once usable stock is available.
              </p>
            )}
            <div>
              <label className="label">
                {action === 'count'
                  ? 'Physical quantity counted'
                  : action === 'correction'
                    ? 'Quantity change (+ / −)'
                    : action === 'damaged'
                      ? 'Damaged quantity (Mootai)'
                      : action === 'opening'
                        ? 'Opening quantity received (Mootai)'
                        : 'Extra quantity received (Mootai)'}
                <span className="text-red-500"> *</span>
              </label>
              <input
                required
                type="number"
                step="0.001"
                min={action === 'correction' ? undefined : action === 'damaged' ? '0.001' : '0'}
                value={form.quantity || ''}
                onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                className="input"
                autoFocus
              />
            </div>
            {(action === 'opening' || action === 'count' || action === 'receipt' ||
              (action === 'correction' && Number(form.quantity) > 0)) && (
              <div>
                <label className="label">
                  {action === 'receipt' ? 'Purchase cost per Mootai' : 'Estimated cost per Mootai'}
                  {action === 'receipt' && <span className="text-red-500"> *</span>}
                </label>
                <input
                  required={action === 'receipt' || (action === 'opening' && Number(form.quantity) > 0)}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitCost || ''}
                  onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))}
                  className="input"
                />
              </div>
            )}
            {(action === 'opening' || action === 'receipt') && (
              <>
                <div>
                  <label className="label">Damaged on arrival (Mootai)</label>
                  <input
                    type="number"
                    min="0"
                    max={form.quantity || undefined}
                    step="0.001"
                    value={form.damagedQuantity || ''}
                    onChange={(event) => setForm((current) => ({ ...current, damagedQuantity: event.target.value }))}
                    className="input"
                    placeholder="0"
                  />
                  {damagedQuantity > quantityInput && (
                    <p className="mt-1 text-xs text-red-700">Damaged quantity cannot exceed quantity received.</p>
                  )}
                </div>
                {damagedQuantity > 0 && (
                  <div>
                    <label className="label">Damage reason</label>
                    <input
                      maxLength={500}
                      value={form.damageReason || ''}
                      onChange={(event) => setForm((current) => ({ ...current, damageReason: event.target.value }))}
                      className="input"
                      placeholder="e.g. damaged during transport"
                    />
                  </div>
                )}
              </>
            )}
            {action === 'receipt' && (
              <div>
                <label className="label">Supplier <span className="text-red-500">*</span></label>
                <select
                  required
                  value={form.supplierId}
                  onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))}
                  className="input"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </div>
            )}
            {(action === 'damaged' || action === 'correction') && (
              <div>
                <label className="label">{action === 'damaged' ? 'Damage reason' : 'Reason'} <span className="text-red-500">*</span></label>
                <textarea
                  required
                  maxLength={500}
                  value={form.reason || ''}
                  onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                  className="input resize-y"
                  placeholder={action === 'damaged' ? 'e.g. spoiled during storage' : ''}
                  rows={3}
                />
              </div>
            )}
            {action === 'receipt' && (
              <div>
                <label className="label">Notes</label>
                <textarea
                  maxLength={500}
                  value={form.notes || ''}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  className="input resize-y"
                  rows={2}
                />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={closeAction} disabled={saving} className="btn-outline flex-1">Cancel</button>
              <button
                type="submit"
                disabled={saving || ((action === 'opening' || action === 'receipt') && damagedQuantity > quantityInput)}
                className="btn-navy flex-1"
              >
                {saving ? 'Saving…' : action === 'receipt' ? 'Add extra stock' : 'Save stock record'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
