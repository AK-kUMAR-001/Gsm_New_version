import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  formatDateCompact,
  formatSaleQuantities,
  getProductEmoji,
  parseDateStr,
  productSalesUnit,
  productStockToSalesFactor,
  productStockUnit,
  realTodayIST,
  todayIST,
} from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import LowStockAlerts from '../components/LowStockAlerts.jsx';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, PackagePlus, Pencil, RefreshCw } from 'lucide-react';

const ACTION_LABELS = {
  opening: 'Enter opening stock',
  count: 'Record morning count',
  receipt: 'Add extra stock',
  damaged: 'Record damaged stock',
  correction: 'Edit stock',
};

const STOCK_PRODUCT_ORDER = ['malli', 'pudina', 'karuvepillai', 'keerai', 'puundu'];

function Quantity({ value, unit }) {
  return <>{Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {unit}</>;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekDates(selectedDate) {
  const start = parseDateStr(selectedDate);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return dateKey(date);
  });
}

function LowStockThreshold({ productId, value, unit, onSave, disabled }) {
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
        <label className="label mb-1" htmlFor={`low-stock-${productId}`}>Warn at or below ({unit})</label>
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
    startInventoryTracking, recordMorningCount, recordStockReceipt, recordStockAdjustment, setStockQuantity,
    updateInventoryLowStockThreshold,
    offline,
  } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [action, setAction] = useState(null);
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({});
  const [expandedProducts, setExpandedProducts] = useState(() => new Set());
  const [expandedMovementDates, setExpandedMovementDates] = useState(() => new Set());
  const [selectedStockDate, setSelectedStockDate] = useState(() => realTodayIST());
  const [todayKey, setTodayKey] = useState(() => realTodayIST());
  const todayKeyRef = useRef(todayKey);
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDate = realTodayIST();
      if (currentDate === todayKeyRef.current) return;
      const previousDate = todayKeyRef.current;
      todayKeyRef.current = currentDate;
      setTodayKey(currentDate);
      setSelectedStockDate((selectedDate) => (
        selectedDate === previousDate ? currentDate : selectedDate
      ));
      loadInventory();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadInventory]);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const stockProducts = useMemo(() => products
    .filter((product) => product.active !== false)
    .sort((a, b) => {
      const aName = String(a.name || '').trim().toLocaleLowerCase();
      const bName = String(b.name || '').trim().toLocaleLowerCase();
      const aOrder = STOCK_PRODUCT_ORDER.indexOf(aName);
      const bOrder = STOCK_PRODUCT_ORDER.indexOf(bName);
      if (aOrder < 0 && bOrder < 0) return aName.localeCompare(bName);
      if (aOrder < 0) return 1;
      if (bOrder < 0) return -1;
      return aOrder - bOrder;
    }), [products]);
  const suppliersById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const activeProductIds = useMemo(() => new Set(stockProducts.map((item) => item.id)), [stockProducts]);
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
    setAction(['opening', 'count', 'receipt', 'damaged', 'correction'].includes(requestedAction)
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
    const stockFactor = productStockToSalesFactor(productsById.get(productId));
    const inputIsStockUnit = action === 'opening' || action === 'receipt' || action === 'count';
    const recordedQuantity = inputIsStockUnit ? quantity * stockFactor : quantity;
    const recordedDamage = inputIsStockUnit ? damagedQuantity * stockFactor : damagedQuantity;
    const recordedUnitCost = form.unitCost
      ? Number(form.unitCost) / (inputIsStockUnit ? stockFactor : 1)
      : null;
    let result;
    if (action === 'opening') {
      result = await startInventoryTracking(
        productId,
        recordedQuantity,
        recordedUnitCost,
        recordedDamage,
        form.damageReason.trim() || null,
        damageRequestId.current,
      );
    } else if (action === 'count') {
      result = await recordMorningCount(productId, recordedQuantity, recordedUnitCost);
    } else if (action === 'receipt') {
      result = await recordStockReceipt(
        productId, form.supplierId, recordedQuantity, Number(recordedUnitCost),
        form.notes.trim() || null, requestId.current,
        recordedDamage, form.damageReason.trim() || null, damageRequestId.current,
      );
    } else if (action === 'damaged') {
      result = await recordStockAdjustment(productId, 'spoilage', -quantity, form.reason.trim(), null, requestId.current);
    } else {
      result = await setStockQuantity(
        productId,
        quantity,
        'Stock balance corrected from Daily Stock In',
        form.unitCost ? Number(form.unitCost) : null,
        requestId.current,
      );
    }
    setSaving(false);
    if (!result?.error) closeAction();
  };

  const product = productsById.get(productId);
  const currentStock = summaryById.get(productId);
  const quantityInput = Number(form.quantity || 0);
  const damagedQuantity = Number(form.damagedQuantity || 0);
  const stockFactor = productStockToSalesFactor(product);
  const stockUnitCost = Number(form.unitCost || 0);
  const salesUnitCost = stockUnitCost > 0 ? stockUnitCost / stockFactor : 0;
  const movements = inventoryMovements
    .filter((movement) => activeProductIds.has(movement.product_id))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const visibleWeekDates = weekDates(selectedStockDate);
  const nextWeekStart = parseDateStr(visibleWeekDates[0]);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const canGoToNextWeek = dateKey(nextWeekStart) <= todayKey;
  const selectedCountsByProduct = new Map(
    inventoryCounts
      .filter((count) => count.stock_date === selectedStockDate)
      .map((count) => [count.product_id, count]),
  );
  const selectedMovements = movements.filter((movement) => movement.movement_date === selectedStockDate);
  const selectedBalanceByProduct = new Map();
  for (const movement of movements) {
    if (movement.movement_date !== selectedStockDate) continue;
    selectedBalanceByProduct.set(
      movement.product_id,
      (selectedBalanceByProduct.get(movement.product_id) || 0) + Number(movement.quantity_delta || 0),
    );
  }
  const selectedSoldByProduct = new Map();
  for (const movement of selectedMovements) {
    if (movement.movement_type === 'sale') {
      selectedSoldByProduct.set(
        movement.product_id,
        (selectedSoldByProduct.get(movement.product_id) || 0) + Math.abs(Number(movement.quantity_delta || 0)),
      );
    }
  }
  const changeWeek = (amount) => {
    const date = parseDateStr(selectedStockDate);
    date.setDate(date.getDate() + amount * 7);
    setSelectedStockDate(dateKey(date));
  };
  const changeDay = (amount) => {
    const date = parseDateStr(selectedStockDate);
    date.setDate(date.getDate() + amount);
    setSelectedStockDate(dateKey(date));
  };
  const movementsByDate = new Map();
  for (const movement of movements) {
    if (!movementsByDate.has(movement.movement_date)) movementsByDate.set(movement.movement_date, []);
    movementsByDate.get(movement.movement_date).push(movement);
  }
  const movementDateKeys = new Set([
    ...movementsByDate.keys(),
    ...inventoryCounts.map((count) => count.stock_date),
  ]);
  const movementDays = [...movementDateKeys]
    .sort((dateA, dateB) => dateB.localeCompare(dateA))
    .map((date) => ({ date, movements: movementsByDate.get(date) || [] }));

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
        {stockProducts.map((item) => {
          const isTracked = settingsById.has(item.id);
          const stock = summaryById.get(item.id);
          const hasCount = countedIds.has(item.id);
          const expanded = expandedProducts.has(item.id);
          const toggleExpanded = () => setExpandedProducts((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return (
            <article key={item.id} className="group metric-card space-y-4">
              <header className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={toggleExpanded}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink-50 text-2xl">
                    {getProductEmoji(item.name, products)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-bold text-ink-900">{item.name}</h2>
                    <p className={`mt-0.5 text-xs ${isTracked ? 'text-green-700' : 'text-ink-500'}`}>
                      {isTracked ? 'Stock tracking enabled' : 'Tracking not started'}
                    </p>
                    <span className="mt-1 block text-xs text-ink-400 md:hidden">
                      {expanded ? 'Tap to hide details' : 'Tap to show details'}
                    </span>
                  </div>
                </button>
                {isTracked && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className={`pill ${hasCount ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      {hasCount ? 'Count complete' : 'Count required'}
                    </span>
                  </div>
                )}
              </header>

              <div className={`overflow-hidden transition-[max-height,opacity] duration-300 ${
                expanded
                  ? 'max-h-[900px] opacity-100'
                  : 'max-h-0 opacity-0 md:group-hover:max-h-[900px] md:group-hover:opacity-100 md:group-focus-within:max-h-[900px] md:group-focus-within:opacity-100'
              }`}>
                {isTracked ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 rounded-2xl bg-ink-50 p-4">
                      <div>
                        <p className="text-xs text-ink-500">Available today</p>
                        <p className="mt-1 font-bold text-ink-900">
                          {hasCount || movements.some((movement) => movement.product_id === item.id)
                            ? <Quantity value={stock?.quantity_on_hand} unit={productSalesUnit(item)} />
                            : 'Not entered today'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-500">Average cost / {productSalesUnit(item)}</p>
                        <p className="mt-1 font-bold text-ink-900">
                          {stock?.average_unit_cost == null ? '—' : currencyINR(stock.average_unit_cost)}
                        </p>
                      </div>
                    </div>
                    <LowStockThreshold
                      productId={item.id}
                      value={settingsById.get(item.id)?.low_stock_threshold}
                      unit={productSalesUnit(item)}
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
                        <Pencil className="h-4 w-4" /> Edit stock
                      </button>
                    </div>
                  </div>
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
              </div>
            </article>
          );
        })}
      </section>

      <section className="metric-card space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-bold text-ink-900">Stock overview · {formatDateCompact(selectedStockDate)}</h2>
            <p className="mt-1 text-xs text-ink-500">Select a day to see its morning count, sales, receipts, and closing balance.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-ink-100 bg-white p-1 lg:ml-auto">
            <button type="button" onClick={() => changeWeek(-1)} className="rounded-lg p-2 text-ink-600 hover:bg-ink-50" aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {visibleWeekDates.map((date) => {
              const dateObject = parseDateStr(date);
              const isSelected = date === selectedStockDate;
              const isFuture = date > todayKey;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedStockDate(date)}
                  disabled={isFuture}
                  aria-pressed={isSelected}
                  className={`min-w-10 rounded-lg px-2 py-1.5 text-center disabled:cursor-not-allowed disabled:opacity-30 ${isSelected ? 'bg-brand-green-dark text-white' : 'text-ink-600 hover:bg-ink-50'}`}
                >
                  <span className="block text-[10px] font-semibold uppercase">{dateObject.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                  <span className="block text-sm font-bold">{dateObject.getDate()}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => changeWeek(1)}
              disabled={!canGoToNextWeek}
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <label className="sr-only" htmlFor="stock-overview-date">Choose stock overview date</label>
            <input
              id="stock-overview-date"
              type="date"
              value={selectedStockDate}
              max={todayKey}
              onChange={(event) => {
                if (event.target.value && event.target.value <= todayKey) setSelectedStockDate(event.target.value);
              }}
              className="min-h-10 rounded-lg border border-ink-100 px-2 text-xs font-semibold text-ink-700"
            />
            <button type="button" onClick={() => changeDay(-1)} className="rounded-lg p-2 text-ink-600 hover:bg-ink-50" aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => changeDay(1)}
              disabled={selectedStockDate >= todayKey}
              className="rounded-lg p-2 text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {selectedStockDate !== todayKey && (
              <button type="button" onClick={() => setSelectedStockDate(todayKey)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-green-dark hover:bg-green-50">
                Today
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {stockProducts.filter((item) => settingsById.has(item.id)).map((item) => {
            const morningCount = selectedCountsByProduct.get(item.id);
            const salesToday = selectedSoldByProduct.get(item.id) || 0;
            const stockFactor = productStockToSalesFactor(item);
            const balance = selectedStockDate === todayKey
              ? summaryById.get(item.id)?.quantity_on_hand
              : selectedBalanceByProduct.has(item.id)
                ? selectedBalanceByProduct.get(item.id)
                : morningCount?.counted_quantity ?? null;
            const unit = productSalesUnit(item);
            const stockUnit = productStockUnit(item);
            return (
              <article key={item.id} className="rounded-2xl border border-ink-100 bg-white p-4">
                <h3 className="font-bold text-ink-900">{getProductEmoji(item.name, products)} {item.name}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <dt className="text-ink-500">Morning count</dt>
                  <dd className="text-right font-semibold text-ink-800">
                    {morningCount ? <Quantity value={morningCount.counted_quantity / stockFactor} unit={stockUnit} /> : 'Not recorded'}
                  </dd>
                  {stockUnit !== unit && (
                    <>
                      <dt className="text-ink-500">Count equivalent</dt>
                      <dd className="text-right font-semibold text-green-700">
                        {morningCount ? <Quantity value={morningCount.counted_quantity} unit={unit} /> : 'Not recorded'}
                      </dd>
                    </>
                  )}
                  <dt className="text-ink-500">Sold</dt>
                  <dd className="text-right font-semibold text-red-700">
                    {formatSaleQuantities({
                      product: item.name,
                      sale_date: selectedStockDate,
                      quantity_unit: unit,
                      mootais: salesToday,
                    }, products)}
                  </dd>
                  <dt className="text-ink-500">{selectedStockDate === todayKey ? 'Current balance' : 'Closing balance'}</dt>
                  <dd className="text-right font-bold text-ink-900">
                    {balance == null ? 'Not recorded' : <Quantity value={Math.max(0, balance)} unit={unit} />}
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section className="metric-card !p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-bold text-ink-900">Stock movement history</h2>
          <p className="text-xs text-ink-500 mt-1">Each date has separate expandable Sales and Stock in details.</p>
        </div>
        {movementDays.length ? (
          <div className="space-y-3 p-3 sm:p-4">
            {movementDays.map(({ date, movements: dayMovements }) => {
              const daySales = dayMovements.filter((movement) => movement.movement_type === 'sale');
              const dayStockMovements = dayMovements.filter((movement) => movement.movement_type !== 'sale');
              const stockProductsForHistory = stockProducts.filter((item) => settingsById.has(item.id));
              const closingBalances = new Map();
              for (const movement of movements) {
                if (movement.movement_date !== date) continue;
                closingBalances.set(
                  movement.product_id,
                  (closingBalances.get(movement.product_id) || 0) + Number(movement.quantity_delta || 0),
                );
              }
              const quantitySummary = (items, productId, predicate) => (
                items
                  .filter((movement) => movement.product_id === productId && predicate(movement))
                  .reduce((sum, movement) => sum + Math.abs(Number(movement.quantity_delta || 0)), 0)
              );
              const renderMovementDetails = (items) => (
                items.length ? (
                  <div className="divide-y divide-ink-100 overflow-x-auto">
                    {items.map((movement) => {
                      const item = productsById.get(movement.product_id);
                      const isSale = movement.movement_type === 'sale';
                      const quantity = Number(movement.quantity_delta || 0);
                      const balance = closingBalances.get(movement.product_id) || 0;
                      return (
                        <div key={movement.id} className={`grid grid-cols-1 items-center gap-2 border-b border-ink-100 px-4 py-3 last:border-b-0 sm:gap-4 ${isSale ? 'sm:grid-cols-[minmax(150px,1fr)_minmax(100px,0.7fr)_minmax(110px,auto)]' : 'sm:grid-cols-[minmax(150px,1fr)_minmax(100px,0.7fr)_minmax(100px,auto)_minmax(120px,auto)]'}`}>
                          <span className="flex items-center gap-2 font-semibold text-ink-900">
                            <span className="text-lg">{getProductEmoji(item?.name, products)}</span>
                            <span>{item?.name || 'Product'}</span>
                          </span>
                          <span className="flex items-center justify-between gap-3 sm:block">
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-400 sm:hidden">Movement</span>
                            <span className="capitalize text-xs text-ink-500">{movement.movement_type === 'spoilage' ? 'Damaged stock' : movement.movement_type.replaceAll('_', ' ')}</span>
                          </span>
                          <span className={`flex items-center justify-between gap-3 ${isSale ? 'sm:justify-end' : 'sm:justify-end sm:gap-6'}`}>
                            <span className="min-w-0">
                              <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                                {isSale ? 'Sold' : 'Quantity'}
                              </span>
                              <span className={`block whitespace-nowrap text-sm font-bold ${isSale || quantity > 0 ? 'text-green-700' : 'text-red-700'}`}>
                                {isSale
                                  ? formatSaleQuantities({
                                    product: item.name,
                                    sale_date: date,
                                    quantity_unit: productSalesUnit(item),
                                    mootais: Math.abs(quantity),
                                  }, products)
                                  : `${Number(quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${productSalesUnit(item)}`}
                              </span>
                            </span>
                            {!isSale && <span className="min-w-0 text-right">
                              <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-400">Balance</span>
                              <span className="block whitespace-nowrap text-sm font-bold text-red-700">
                                {Number(Math.max(0, balance)).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {productSalesUnit(item)}
                              </span>
                            </span>}
                          </span>
                          {(movement.supplier_id || (movement.reason && !isSale)) && (
                            <span className="text-xs text-ink-500 sm:col-span-4">
                              {movement.supplier_id ? suppliersById.get(movement.supplier_id)?.name || 'Supplier' : movement.reason}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="px-4 py-5 text-center text-sm text-ink-500">No matching movements for this date.</p>
              );
              const renderDayCell = (kind, items, quantityForProduct, emptyLabel) => {
                const key = `${date}:${kind}`;
                const expanded = expandedMovementDates.has(key);
                const toggle = () => setExpandedMovementDates((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
                return (
                  <section key={key} className="overflow-hidden rounded-xl border border-ink-100 bg-white">
                    <button
                      type="button"
                      onClick={toggle}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50"
                    >
                      <span className="min-w-[90px] shrink-0">
                        <span className="block font-bold text-ink-900">{formatDateCompact(date)}</span>
                        <span className="mt-0.5 block text-xs font-semibold text-ink-600">{kind === 'sales' ? 'Sales' : 'Stock in'}</span>
                      </span>
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="block text-right text-xs font-medium text-ink-500">
                          {items.length
                            ? `${items.length} ${kind === 'sales' ? (items.length === 1 ? 'sale' : 'sales') : (items.length === 1 ? 'stock movement' : 'stock movements')}`
                            : emptyLabel}
                        </span>
                      </span>
                      <ChevronDown className={`h-5 w-5 shrink-0 text-ink-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="border-t border-ink-100">
                        {renderMovementDetails(items)}
                      </div>
                    )}
                  </section>
                );
              };
              return (
                <div key={date} className="space-y-2">
                  {renderDayCell(
                    'sales',
                    daySales,
                    (productId) => quantitySummary(daySales, productId, () => true),
                    'No sales recorded',
                  )}
                  {renderDayCell(
                    'stock',
                    dayStockMovements,
                    (productId) => quantitySummary(dayStockMovements, productId, (movement) => ['opening', 'receipt'].includes(movement.movement_type)),
                    'No stock movements recorded',
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            {inventoryLoading ? 'Loading stock movements…' : 'No stock movements have been recorded.'}
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
              <p className="text-xs text-ink-500">
                Enter the corrected total stock balance, including 0 if the product is out of stock.
                The difference is recorded as a correction; past sales and stock entries are not rewritten.
              </p>
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
            {(action === 'opening' || action === 'receipt') ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">
                    {action === 'opening' ? 'Opening quantity' : 'Quantity received'} ({productStockUnit(product)})
                    <span className="text-red-500"> *</span>
                  </label>
                  <input
                    required
                    type="number"
                    step="0.001"
                    min="0"
                    value={form.quantity || ''}
                    onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                    className="input"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">
                    {action === 'receipt' ? 'Purchase cost' : 'Estimated cost'} per {productStockUnit(product)} (₹)
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
                <div>
                  <label className="label">{productSalesUnit(product)} per {productStockUnit(product)}</label>
                  <input
                    readOnly
                    value={stockFactor.toLocaleString('en-IN')}
                    className="input bg-ink-50"
                    aria-label={`${productSalesUnit(product)} per ${productStockUnit(product)}`}
                  />
                </div>
                <div>
                  <label className="label">Calculated cost per {productSalesUnit(product)} (₹)</label>
                  <input
                    readOnly
                    value={salesUnitCost > 0 ? salesUnitCost.toLocaleString('en-IN', { maximumFractionDigits: 6 }) : ''}
                    className="input bg-ink-50"
                    aria-label={`Calculated cost per ${productSalesUnit(product)}`}
                  />
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="label">
                    {action === 'count'
                      ? `Physical quantity counted (${productStockUnit(product)})`
                      : action === 'correction'
                        ? `Correct total available stock (${productSalesUnit(product)})`
                        : `Damaged quantity (${productSalesUnit(product)})`}
                    <span className="text-red-500"> *</span>
                  </label>
                  <input
                    required
                    type="number"
                    step="0.001"
                    min={action === 'damaged' ? '0.001' : '0'}
                    value={form.quantity || ''}
                    onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                    className="input"
                    autoFocus
                  />
                </div>
                {(action === 'count' || (action === 'correction' && Number(form.quantity) > 0)) && (
                  <div>
                    <label className="label">
                      Estimated cost per {action === 'count' ? productStockUnit(product) : productSalesUnit(product)}
                      {action === 'correction' && Number(currentStock?.quantity_on_hand || 0) <= 0 && quantityInput > 0 && (
                        <span className="text-red-500"> *</span>
                      )}
                    </label>
                    <input
                      required={action === 'correction' && Number(currentStock?.quantity_on_hand || 0) <= 0 && quantityInput > 0}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.unitCost || ''}
                      onChange={(event) => setForm((current) => ({ ...current, unitCost: event.target.value }))}
                      className="input"
                    />
                  </div>
                )}
              </>
            )}
            {(action === 'opening' || action === 'receipt') && (
              <>
                <div>
                  <label className="label">Damaged on arrival ({productStockUnit(product)})</label>
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
            {action === 'damaged' && (
              <div>
                <label className="label">Damage reason <span className="text-red-500">*</span></label>
                <textarea
                  required
                  maxLength={500}
                  value={form.reason || ''}
                  onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                  className="input resize-y"
                  placeholder="e.g. spoiled during storage"
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
