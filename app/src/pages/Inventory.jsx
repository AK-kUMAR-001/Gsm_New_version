import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  formatDateCompact,
  formatMovementQuantities,
  formatMalliKgEquivalent,
  formatProductQuantities,
  formatSaleRates,
  getProductEmoji,
  productSalesUnit,
  productStockToSalesFactor,
  productStockUnit,
  normalizeStockQuantityInput,
  stockQuantityInputUnits,
  todayIST,
} from '../lib/business.js';
import Modal from '../components/Modal.jsx';
import { AlertTriangle, Check, ClipboardCheck, PackagePlus, Pencil, RefreshCw, Trash2 } from 'lucide-react';

const ACTION_LABELS = {
  opening: 'Enter opening stock',
  count: 'Record morning count',
  receipt: 'Add extra stock',
  damaged: 'Record damaged stock',
  correction: 'Edit stock',
};

const STOCK_PRODUCT_ORDER = ['malli', 'pudina', 'karuvepillai', 'keerai'];

function LowStockThreshold({ productId, value, product, onSave, disabled }) {
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
        <label className="label mb-1" htmlFor={`low-stock-${productId}`}>Warn at or below ({productSalesUnit(product)})</label>
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
      <p className="w-full text-xs text-ink-500">
        Equivalent: {formatProductQuantities(product, Number(threshold) || 0)}. Set 0 to turn off this warning.
      </p>
    </form>
  );
}

export default function Inventory() {
  const {
    products, suppliers, inventorySettings, inventorySummary, inventoryCounts,
    buyers, buyerSales, retailSales, inventoryMovements, inventoryLoading, inventoryError, loadInventory,
    startInventoryTracking, recordMorningCount, deleteMorningCount, recordStockReceipt, recordStockAdjustment, setStockQuantity,
    updateInventoryLowStockThreshold, updateProduct,
    offline,
  } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [action, setAction] = useState(null);
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({});
  const [expandedProducts, setExpandedProducts] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [deletingCountProductId, setDeletingCountProductId] = useState('');
  const [deleteCountTarget, setDeleteCountTarget] = useState(null);
  const [deleteCountConfirmation, setDeleteCountConfirmation] = useState('');
  const [inventoryReady, setInventoryReady] = useState(false);
  const [redirectNotice, setRedirectNotice] = useState('');
  const [movementDate, setMovementDate] = useState(todayIST());
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
  const buyersById = useMemo(() => new Map(buyers.map((buyer) => [buyer.id, buyer])), [buyers]);
  const salesBySource = useMemo(() => {
    const result = new Map();
    for (const sale of buyerSales) result.set(`buyer_sales:${sale.id}`, sale);
    for (const sale of retailSales) result.set(`retail_sales:${sale.id}`, sale);
    return result;
  }, [buyerSales, retailSales]);
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
  const countsByProductId = useMemo(() => new Map(
    inventoryCounts
      .filter((count) => count.stock_date === todayIST())
      .map((count) => [count.product_id, count])
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
    const requestedDate = location.state?.stockDate || searchParams.get('stockDate') || todayIST();
    const selectedMovementDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      && !Number.isNaN(Date.parse(requestedDate))
      && requestedDate <= todayIST()
      ? requestedDate
      : todayIST();
    setAction(['opening', 'count', 'receipt', 'damaged', 'correction'].includes(requestedAction)
      ? requestedAction
      : isTracked ? (countedIds.has(target.id) ? 'receipt' : 'count') : 'opening');
    setMovementDate(selectedMovementDate);
    setRedirectNotice(location.state?.stockRedirectNotice || '');
    setProductId(target.id);
    requestId.current = window.crypto.randomUUID();
    damageRequestId.current = window.crypto.randomUUID();
    const currentCount = requestedAction === 'count' ? countsByProductId.get(target.id) : null;
    const countUnit = productStockUnit(target);
    const countFactor = countUnit === productSalesUnit(target) ? 1 : productStockToSalesFactor(target);
    setForm({
      quantity: currentCount ? String(Number(currentCount.counted_quantity) / countFactor) : '',
      unitCost: '', supplierId: '', reason: '', notes: '',
      damagedQuantity: '', damageReason: '',
      stockToSalesFactor: String(productStockToSalesFactor(target)),
      movementDate: selectedMovementDate,
      quantityUnit: ['count', 'correction'].includes(requestedAction)
        ? requestedAction === 'count' ? countUnit : productSalesUnit(target)
        : '',
    });
    searchParams.delete('stockProductName');
    searchParams.delete('stockAction');
    searchParams.delete('stockDate');
    const remainingQuery = searchParams.toString();
    navigate({
      pathname: location.pathname,
      search: remainingQuery ? `?${remainingQuery}` : '',
    }, { replace: true, state: null });
  }, [countedIds, countsByProductId, inventoryError, inventoryReady, location.key, location.pathname, location.search, location.state, navigate, products, settingsById]);

  const openAction = (nextAction, product) => {
    setAction(nextAction);
    setProductId(product.id);
    setRedirectNotice('');
    requestId.current = window.crypto.randomUUID();
    damageRequestId.current = window.crypto.randomUUID();
    const currentCount = nextAction === 'count' ? countsByProductId.get(product.id) : null;
    const countUnit = productStockUnit(product);
    const countFactor = countUnit === productSalesUnit(product) ? 1 : productStockToSalesFactor(product);
    setForm({
      quantity: currentCount ? String(Number(currentCount.counted_quantity) / countFactor) : '',
      unitCost: '', supplierId: '', reason: '', notes: '',
      damagedQuantity: '', damageReason: '',
      stockToSalesFactor: String(productStockToSalesFactor(product)),
      movementDate: todayIST(),
      quantityUnit: ['count', 'correction'].includes(nextAction)
        ? nextAction === 'count' ? countUnit : productSalesUnit(product)
        : '',
    });
    setMovementDate(todayIST());
  };
  const closeAction = () => {
    setAction(null);
    setProductId('');
    setForm({});
    setRedirectNotice('');
    requestId.current = null;
    damageRequestId.current = null;
  };

  const removeMorningCount = async (product) => {
    setDeleteCountTarget(product);
    setDeleteCountConfirmation('');
  };

  const confirmDeleteMorningCount = async (event) => {
    event.preventDefault();
    if (!deleteCountTarget || deleteCountConfirmation.trim().toUpperCase() !== 'YES') return;
    const target = deleteCountTarget;
    setDeletingCountProductId(target.id);
    try {
      const result = await deleteMorningCount(target.id);
      if (!result.error) {
        setDeleteCountTarget(null);
        setDeleteCountConfirmation('');
      }
    } finally {
      setDeletingCountProductId('');
    }
  };

  const submitAction = async (event) => {
    event.preventDefault();
    if (!action || !productId) return;
    setSaving(true);
    const quantity = Number(form.quantity);
    const damagedQuantity = Number(form.damagedQuantity || 0);
    const currentProduct = productsById.get(productId);
    const isKeerai = String(currentProduct?.name || '').trim().toLocaleLowerCase() === 'keerai';
    const stockFactor = isKeerai && ['opening', 'receipt'].includes(action)
      ? Number(form.stockToSalesFactor)
      : productStockToSalesFactor(currentProduct);
    if (!Number.isFinite(stockFactor) || stockFactor <= 0) {
      window.alert(`Enter a valid number of ${productSalesUnit(currentProduct)} per ${productStockUnit(currentProduct)}.`);
      setSaving(false);
      return;
    }
    const needsKeeraiUnitSetup = currentProduct?.sales_unit !== 'Kattu'
      || currentProduct?.stock_entry_unit !== 'Mootai'
      || stockFactor !== Number(currentProduct?.stock_to_sales_factor || 1);
    if (isKeerai && ['opening', 'receipt'].includes(action) && needsKeeraiUnitSetup) {
      const productHasHistory = inventoryMovements.some((movement) => movement.product_id === productId);
      if (productHasHistory) {
        window.alert('Keerai’s unit conversion cannot be changed after stock movements have been recorded.');
        setSaving(false);
        return;
      }
      const productUpdate = await updateProduct(productId, {
        sales_unit: 'Kattu',
        stock_entry_unit: 'Mootai',
        stock_to_sales_factor: stockFactor,
      });
      if (productUpdate.error) {
        setSaving(false);
        return;
      }
    }
    const inputIsStockUnit = action === 'opening' || action === 'receipt';
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
      const countInput = normalizeStockQuantityInput(
        productsById.get(productId),
        quantity,
        form.quantityUnit || productSalesUnit(productsById.get(productId)),
        form.unitCost,
      );
      result = countedIds.has(productId)
        ? await correctMorningCount(productId, countInput.quantity, countInput.unitCost)
        : await recordMorningCount(productId, countInput.quantity, countInput.unitCost);
    } else if (action === 'receipt') {
      result = await recordStockReceipt(
        productId, form.supplierId || null, recordedQuantity, Number(recordedUnitCost),
        form.notes.trim() || null, requestId.current,
        recordedDamage, form.damageReason.trim() || null, damageRequestId.current,
        form.movementDate,
      );
    } else if (action === 'damaged') {
      result = await recordStockAdjustment(productId, 'spoilage', -quantity, form.reason.trim(), null, requestId.current);
    } else {
      const stockInput = normalizeStockQuantityInput(
        productsById.get(productId),
        quantity,
        form.quantityUnit || productSalesUnit(productsById.get(productId)),
        form.unitCost,
      );
      result = await setStockQuantity(
        productId,
        stockInput.quantity,
        'Stock balance corrected from Daily Stock In',
        stockInput.unitCost,
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
  const isKeerai = String(product?.name || '').trim().toLocaleLowerCase() === 'keerai';
  const productHasMovements = inventoryMovements.some((movement) => movement.product_id === productId);
  const stockFactor = isKeerai && ['opening', 'receipt'].includes(action)
    ? Number(form.stockToSalesFactor || productStockToSalesFactor(product))
    : productStockToSalesFactor(product);
  const stockUnitCost = Number(form.unitCost || 0);
  const unitCostRequired = quantityInput > 0 && (
    (action === 'count' && (
      countedIds.has(productId) || Number(currentStock?.quantity_on_hand || 0) <= 0
    ))
    || (action === 'correction' && Number(currentStock?.quantity_on_hand || 0) <= 0)
  );
  const salesUnitCost = stockUnitCost > 0 ? stockUnitCost / stockFactor : 0;
  const movements = inventoryMovements
    .filter((movement) => activeProductIds.has(movement.product_id) && movement.movement_date === movementDate)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

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
                        <p className={`mt-1 font-bold ${Number(stock?.quantity_on_hand || 0) < 0 ? 'text-red-700' : 'text-ink-900'}`}>
                          {countedIds.has(item.id) || movements.some((movement) => movement.product_id === item.id)
                            ? formatProductQuantities(item, stock?.quantity_on_hand)
                            : 'Not entered today'}
                        </p>
                        {Number(stock?.quantity_on_hand || 0) < 0 && (
                          <p className="mt-1 text-xs font-medium text-red-700">
                            Recorded sales exceed stock. Reconcile against verified receipts; the morning count has not been changed.
                          </p>
                        )}
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
                      product={item}
                      onSave={(threshold) => updateInventoryLowStockThreshold(item.id, threshold)}
                      disabled={offline}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => openAction('count', item)} className="btn-navy">
                        <ClipboardCheck className="w-4 h-4" />
                        {hasCount ? 'Correct morning count' : 'Morning count'}
                      </button>
                      <button type="button" onClick={() => openAction('receipt', item)} className="btn-outline">
                        <PackagePlus className="w-4 h-4" /> Add extra stock
                      </button>
                      <button type="button" onClick={() => openAction('damaged', item)} className="btn-outline">
                        <AlertTriangle className="w-4 h-4" /> Damaged stock
                      </button>
                      <button type="button" onClick={() => openAction('correction', item)} className="btn-outline">
                        <Pencil className="h-4 w-4" /> Edit stock
                      </button>
                      {hasCount && (
                        <button
                          type="button"
                          onClick={() => removeMorningCount(item)}
                          disabled={offline || saving || deletingCountProductId !== ''}
                          className="btn-outline border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          {deletingCountProductId === item.id ? 'Deleting…' : 'Delete stock'}
                        </button>
                      )}
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

      <section className="metric-card !p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-bold text-ink-900">Stock movements · {formatDateCompact(movementDate)}</h2>
          <p className="text-xs text-ink-500 mt-1">The stock balance includes all saved movements.</p>
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
                {movements.map((movement) => {
                  const sale = salesBySource.get(`${movement.source_kind}:${movement.source_id}`);
                  const amount = sale
                    ? Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
                    : null;
                  return (
                    <tr key={movement.id}>
                      <td className="px-5 py-3 whitespace-nowrap">{formatDateCompact(movement.movement_date)}</td>
                      <td className="px-5 py-3">{productsById.get(movement.product_id)?.name || 'Product'}</td>
                      <td className="px-5 py-3 capitalize">{movement.movement_type === 'spoilage' ? 'Damaged stock' : movement.movement_type.replaceAll('_', ' ')}</td>
                      <td className={`px-5 py-3 text-right whitespace-nowrap font-semibold ${Number(movement.quantity_delta) < 0 ? 'text-red-700' : 'text-green-700'}`}>
                        {Number(movement.quantity_delta) > 0 ? '+' : ''}
                        {formatMovementQuantities(
                          movement,
                          productsById.get(movement.product_id),
                          sale,
                          products
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-500">
                        {sale ? (
                          <>
                            {sale.buyer_id && buyersById.get(sale.buyer_id)?.archived_at && (
                              <span className="mb-1 block font-semibold text-amber-700">Archived buyer · stock history preserved</span>
                            )}
                            <span className="block">{formatSaleRates(sale, products)}</span>
                            <span className="block font-semibold text-ink-800">Sale amount: {currencyINR(amount)}</span>
                          </>
                        ) : movement.movement_type === 'sale' ? (
                          'Sale record unavailable'
                        ) : movement.supplier_id ? suppliersById.get(movement.supplier_id)?.name || 'Supplier' : movement.reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            {inventoryLoading ? 'Loading stock movements…' : `No stock movements recorded on ${formatDateCompact(movementDate)}.`}
          </p>
        )}
      </section>

      <Modal
        open={!!action}
        onClose={closeAction}
        title={action === 'count' && countedIds.has(productId) ? 'Correct morning count' : action ? ACTION_LABELS[action] : ''}
      >
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
            {action === 'count' && countedIds.has(productId) && (
              <p className="text-xs text-ink-500">
                Enter the actual morning stock and its purchase cost. Today’s saved sales are retained, their stock costs are recalculated, and the remaining balance updates automatically.
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
            {action === 'receipt' && (
              <div>
                <label className="label">Stock-in date <span className="text-red-500">*</span></label>
                <input
                  required
                  type="date"
                  max={todayIST()}
                  value={form.movementDate || todayIST()}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setForm((current) => ({ ...current, movementDate: nextDate }));
                    setMovementDate(nextDate);
                  }}
                  className="input"
                />
              </div>
            )}
            {action === 'opening' || action === 'receipt' ? (
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
                  {formatMalliKgEquivalent(product, quantityInput, productStockUnit(product)) && (
                    <p className="mt-1 text-xs text-ink-500">
                      Equivalent: {formatMalliKgEquivalent(product, quantityInput, productStockUnit(product))}
                    </p>
                  )}
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
                    type={isKeerai && !productHasMovements ? 'number' : 'text'}
                    min="0.000001"
                    step="any"
                    required={isKeerai && !productHasMovements}
                    readOnly={!isKeerai || productHasMovements}
                    value={form.stockToSalesFactor ?? stockFactor.toLocaleString('en-IN')}
                    onChange={(event) => setForm((current) => ({ ...current, stockToSalesFactor: event.target.value }))}
                    className={`input ${!isKeerai || productHasMovements ? 'bg-ink-50' : ''}`}
                    aria-label={`${productSalesUnit(product)} per ${productStockUnit(product)}`}
                  />
                  {isKeerai && !productHasMovements && (
                    <p className="mt-1 text-xs text-ink-500">
                      Enter the Kattu in 1 Mootai. This ratio is saved for future stock and sales calculations.
                    </p>
                  )}
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
                      ? 'Physical quantity counted'
                      : action === 'correction'
                        ? `Correct total available stock (${productSalesUnit(product)})`
                        : `Damaged quantity (${productSalesUnit(product)})`}
                    <span className="text-red-500"> *</span>
                  </label>
                  <div className={['count', 'correction'].includes(action) ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3' : ''}>
                    {['count', 'correction'].includes(action) && (
                      <div>
                        <label className="label" htmlFor="stock-quantity-unit">
                          {action === 'count' ? 'Count unit' : 'Balance unit'}
                        </label>
                        <select
                          id="stock-quantity-unit"
                          value={form.quantityUnit || productSalesUnit(product)}
                          onChange={(event) => setForm((current) => ({ ...current, quantityUnit: event.target.value }))}
                          className="input"
                        >
                          {stockQuantityInputUnits(product).map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="label" htmlFor="stock-quantity">
                        {['count', 'correction'].includes(action)
                          ? `${form.quantityUnit || productSalesUnit(product)} quantity`
                          : 'Quantity'}
                      </label>
                      <input
                        id="stock-quantity"
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
                  </div>
                  {['count', 'correction'].includes(action) && quantityInput > 0 && (
                    <p className="mt-1 text-xs text-ink-500">
                      Equivalent: {formatProductQuantities(
                        product,
                        normalizeStockQuantityInput(
                          product,
                          quantityInput,
                          form.quantityUnit || productSalesUnit(product),
                        ).quantity,
                      )}
                    </p>
                  )}
                  {!['count', 'correction'].includes(action) && formatMalliKgEquivalent(product, quantityInput, productSalesUnit(product)) && (
                    <p className="mt-1 text-xs text-ink-500">
                      Equivalent: {formatMalliKgEquivalent(product, quantityInput, productSalesUnit(product))}
                    </p>
                  )}
                </div>
                {(action === 'count' || (action === 'correction' && Number(form.quantity) > 0)) && (
                  <div>
                    <label className="label">
                      {action === 'count' && countedIds.has(productId) ? 'Purchase cost' : 'Estimated cost'} per {['count', 'correction'].includes(action)
                        ? (form.quantityUnit || productSalesUnit(product))
                        : productSalesUnit(product)}
                      {unitCostRequired && <span className="text-red-500"> *</span>}
                    </label>
                    <input
                      required={unitCostRequired}
                      type="number"
                      min={unitCostRequired ? '0.01' : '0'}
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
                  {formatMalliKgEquivalent(
                    product,
                    damagedQuantity,
                    action === 'opening' || action === 'receipt' ? productStockUnit(product) : productSalesUnit(product)
                  ) && (
                    <p className="mt-1 text-xs text-ink-500">
                      Equivalent: {formatMalliKgEquivalent(
                        product,
                        damagedQuantity,
                        action === 'opening' || action === 'receipt' ? productStockUnit(product) : productSalesUnit(product)
                      )}
                    </p>
                  )}
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
                <label className="label">Supplier (optional)</label>
                <select
                  value={form.supplierId}
                  onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))}
                  className="input"
                >
                  <option value="">No supplier</option>
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

      <Modal
        open={!!deleteCountTarget}
        onClose={() => {
          if (deletingCountProductId) return;
          setDeleteCountTarget(null);
          setDeleteCountConfirmation('');
        }}
        title="Delete morning stock"
      >
        {deleteCountTarget && (
          <form onSubmit={confirmDeleteMorningCount} className="space-y-4">
            <p className="text-sm text-ink-700">
              This deletes {deleteCountTarget.name}'s morning count for today, its count adjustment, and reopens today's retail session. Automatically generated retail close-out sales are removed; recorded buyer/retail sales, receipts, and damage entries stay.
            </p>
            <div>
              <label className="label" htmlFor="delete-stock-confirmation">
                Type <span className="font-bold">YES</span> to confirm
              </label>
              <input
                id="delete-stock-confirmation"
                required
                autoComplete="off"
                value={deleteCountConfirmation}
                onChange={(event) => setDeleteCountConfirmation(event.target.value)}
                className="input"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteCountTarget(null);
                  setDeleteCountConfirmation('');
                }}
                disabled={!!deletingCountProductId}
                className="btn-outline flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deleteCountConfirmation.trim().toUpperCase() !== 'YES' || !!deletingCountProductId}
                className="btn-outline flex-1 justify-center border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deletingCountProductId ? 'Deleting…' : 'Delete stock'}
              </button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
}
