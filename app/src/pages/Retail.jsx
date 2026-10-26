import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  formatDateCompact,
  formatSaleQuantities,
  formatSaleRates,
  formatQuantityByUnit,
  getProductEmoji,
  saleQuantitiesByUnit,
  productSalesUnit,
  todayIST,
} from '../lib/business.js';
import PeriodPills, { RETAIL_PERIOD_OPTIONS } from '../components/PeriodPills.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import StartRetailDayModal from '../components/StartRetailDayModal.jsx';
import Modal from '../components/Modal.jsx';
import { Plus, RefreshCw, TrendingUp, Package, ShoppingBag, ChevronRight, Store } from 'lucide-react';

export default function Retail() {
  const {
    retailSales,
    products,
    activeProducts,
    inventorySettings,
    inventoryCounts,
    inventoryMovements,
    inventoryLoading,
    inventoryError,
    loadInventory,
    retailDaySession,
    retailDayPrices,
    retailDayLoading,
    retailDayError,
    loadRetailDay,
    startRetailDay,
    finishRetailDay,
    filterByPeriod,
    load,
  } = useAppData();

  const [period, setPeriod] = useState('week');
  const [modalOpen, setModalOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [dayActionBusy, setDayActionBusy] = useState(false);
  const [retailDayReady, setRetailDayReady] = useState(false);
  const [actionError, setActionError] = useState('');
  const [expandedDate, setExpandedDate] = useState(null);
  const cardRefs = useRef({});
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    let mounted = true;
    Promise.all([loadRetailDay(), loadInventory()]).then(() => {
      if (mounted) setRetailDayReady(true);
    });
    return () => { mounted = false; };
  }, [loadRetailDay, loadInventory]);

  useEffect(() => {
    if (searchParams.get('start') !== '1' || !retailDayReady || retailDayLoading || retailDayError) return;
    if (!retailDaySession) setStartModalOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, retailDayError, retailDayLoading, retailDayReady, retailDaySession]);

  const trackedActiveProducts = useMemo(
    () => activeProducts.filter((product) => inventorySettings.some((setting) => setting.product_id === product.id)),
    [activeProducts, inventorySettings],
  );

  const todayStockByProduct = useMemo(() => {
    const balances = new Map();
    const today = todayIST();
    for (const movement of inventoryMovements) {
      if (movement.movement_date !== today) continue;
      balances.set(
        movement.product_id,
        (balances.get(movement.product_id) || 0) + Number(movement.quantity_delta || 0),
      );
    }
    return balances;
  }, [inventoryMovements]);

  const missingTodayCounts = inventorySettings.filter((setting) => (
    activeProducts.some((product) => product.id === setting.product_id)
    && !inventoryCounts.some((count) => count.product_id === setting.product_id && count.stock_date === todayIST())
  ));
  const savedRetailPrices = new Map(retailDayPrices.map((price) => [price.product_id, price]));
  const retailDayActive = retailDaySession?.status === 'active';
  const retailDayFinished = retailDaySession?.status === 'finished';

  const handleStartRetail = async (prices) => {
    setActionError('');
    setDayActionBusy(true);
    const result = await startRetailDay(prices);
    setDayActionBusy(false);
    if (result.error) {
      setActionError(result.error.message);
      return;
    }
    setStartModalOpen(false);
  };

  const handleFinishRetail = async () => {
    setActionError('');
    setDayActionBusy(true);
    const result = await finishRetailDay();
    setDayActionBusy(false);
    if (result.error) {
      setActionError(result.error.message);
      return;
    }
    setFinishModalOpen(false);
  };

  const filtered = useMemo(() => {
    return filterByPeriod(retailSales || [], period, 'sale_date').sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));
  }, [retailSales, period, filterByPeriod]);

  const stats = useMemo(() => {
    let revenue = 0;
    const quantities = {};
    for (const s of filtered) {
      const q = s.mootais_sold ?? s.mootais ?? 0;
      const r = s.price_per_mootai ?? 0;
      revenue += q * r;
      for (const [unit, value] of Object.entries(saleQuantitiesByUnit(s, products))) {
        quantities[unit] = (quantities[unit] || 0) + value;
      }
    }
    return {
      revenue,
      quantities,
      count: filtered.length,
    };
  }, [filtered, products]);

  const groupedSales = useMemo(() => {
    const map = new Map();

    for (const sale of filtered) {
      const dateKey = (sale.sale_date || '').slice(0, 10);
      if (!dateKey) continue;

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          date: dateKey,
          sales: [],
          quantities: {},
          totalRevenue: 0,
        });
      }

      const qty = Number(sale.mootais_sold ?? sale.mootais ?? 0);
      const rate = Number(sale.price_per_mootai ?? 0);
      const total = qty * rate;

      const entry = map.get(dateKey);
      entry.sales.push({ ...sale, qty, rate, total });
      for (const [unit, value] of Object.entries(saleQuantitiesByUnit(sale, products))) {
        entry.quantities[unit] = (entry.quantities[unit] || 0) + value;
      }
      entry.totalRevenue += total;
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filtered, products]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!expandedDate) return;
      const activeCard = cardRefs.current[expandedDate];
      if (activeCard && !activeCard.contains(event.target)) {
        setExpandedDate(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedDate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-ink-900 flex items-center gap-2.5">
            <ShoppingBag className="w-7 h-7 text-brand-purple" />
            Retail Sales
          </h1>
        </div>
        <button onClick={() => load()} className="btn-ghost" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={() => setModalOpen(true)} className="btn-green">
          <Plus className="w-4 h-4" />
          Record Retail Sale
        </button>
      </div>

      {(retailDayError || inventoryError || actionError) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {actionError || retailDayError || inventoryError}
        </div>
      )}

      {retailDayLoading || inventoryLoading ? (
        <div className="metric-card text-sm text-ink-500">Loading today’s retail balance…</div>
      ) : (
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold text-violet-950">
                <Store className="h-5 w-5" />
                {retailDayActive ? 'Retail sales are active today' : retailDayFinished ? 'Retail sales finished today' : 'Start today’s retail sales'}
              </h2>
              <p className="mt-1 text-sm text-violet-900">
                {retailDayActive
                  ? 'Balances update as buyer and recorded retail sales use stock. Finish Retail records all remaining balance at the saved prices.'
                  : retailDayFinished
                    ? 'Today’s remaining balance has been recorded as retail sales.'
                    : 'Set today’s prices after physical stock counts are complete. Buyer sales will reduce the displayed balance.'}
              </p>
            </div>
            {!retailDayActive && !retailDayFinished && (
              <button
                type="button"
                onClick={() => setStartModalOpen(true)}
                disabled={retailDayLoading || missingTodayCounts.length > 0 || trackedActiveProducts.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Store className="h-4 w-4" />
                Retail Sales Start
              </button>
            )}
            {retailDayActive && (
              <button
                type="button"
                onClick={() => setFinishModalOpen(true)}
                className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-800"
              >
                Finish Retail
              </button>
            )}
          </div>

          {missingTodayCounts.length > 0 && !retailDayActive && (
            <p className="mt-3 text-sm font-semibold text-amber-800">
              Record today’s physical count for each active tracked item before starting retail.
            </p>
          )}

          {(retailDayActive || retailDayFinished) && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {trackedActiveProducts.map((product) => {
                const savedPrice = savedRetailPrices.get(product.id);
                const unit = savedPrice?.quantity_unit || productSalesUnit(product);
                const balance = todayStockByProduct.get(product.id) || 0;
                return (
                  <div key={product.id} className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-white p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span>{getProductEmoji(product.name, products)}</span>
                      <span className="truncate text-sm font-semibold text-ink-800">{product.name}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-violet-900">
                        {balance.toLocaleString('en-IN', { maximumFractionDigits: 3 })} {unit}
                      </div>
                      {savedPrice && (
                        <div className="text-xs text-ink-500">
                          {currencyINR(savedPrice.price_per_unit)} / {unit}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <PeriodPills value={period} onChange={setPeriod} options={RETAIL_PERIOD_OPTIONS} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-500 uppercase tracking-wide">Total Revenue</div>
              <div className="text-2xl font-extrabold text-ink-900 mt-1">{currencyINR(stats.revenue)}</div>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Package className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-500 uppercase tracking-wide">Total quantity sold</div>
              <div className="text-2xl font-extrabold text-ink-900 mt-1">{formatQuantityByUnit(stats.quantities) || '0'}</div>
            </div>
          </div>
        </div>

        <div className="metric-card sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-500 uppercase tracking-wide">Sales Count</div>
              <div className="text-2xl font-extrabold text-ink-900 mt-1">{stats.count}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {groupedSales.length === 0 ? (
          <div className="metric-card flex flex-col items-center justify-center py-16 text-center">
            <Package className="w-10 h-10 mb-3 text-ink-300" />
            <div className="font-semibold text-ink-700 mb-1">No retail sales yet</div>
            <div className="text-sm text-ink-500">Record a retail sale to get started.</div>
          </div>
        ) : (
          groupedSales.map((group) => {
            const isOpen = expandedDate === group.date;

            return (
              <div
                key={group.date}
                ref={(el) => {
                  cardRefs.current[group.date] = el;
                }}
                className={`rounded-3xl border transition-all duration-200 ${isOpen
                  ? 'border-violet-200 bg-white shadow-lg shadow-violet-100/60'
                  : 'border-ink-200 bg-white/80 hover:border-violet-200 hover:shadow-md'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedDate((current) => (current === group.date ? null : group.date))}
                  className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-4 text-left"
                >
                  <div className="col-start-1 row-start-1 flex items-center gap-3 min-w-0 sm:col-auto sm:row-auto">
                    <div className="w-10 h-10 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="text-base md:text-lg text-ink-900 font-bold truncate">
                        📅 {formatDateCompact(group.date)}
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 row-start-2 justify-self-center flex items-center gap-1.5 whitespace-nowrap text-base md:text-lg text-ink-700 sm:col-auto sm:row-auto">
                    <span>{group.sales.length} sales</span>
                    <span className="text-ink-400">·</span>
                    <span>{formatQuantityByUnit(group.quantities)}</span>
                  </div>

                  <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 min-w-0 sm:col-auto sm:row-auto">
                    <span className="text-base md:text-lg font-extrabold text-emerald-700 whitespace-nowrap">
                      {currencyINR(group.totalRevenue)}
                    </span>
                    <ChevronRight className={`w-5 h-5 text-ink-500 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-ink-100 px-4 py-4">
                    <div className="space-y-3">
                      {group.sales.map((sale) => (
                        <div
                          key={sale.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl bg-ink-50 p-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xl shrink-0">{getProductEmoji(sale.product, products)}</span>

                            <div className="min-w-0">
                              <div className="text-lg sm:text-xl font-bold text-ink-900 truncate">
                                {sale.product || '(Unknown)'}
                              </div>
                              <div className="text-sm sm:text-base text-ink-500">
                                {formatSaleQuantities(sale, products)} · {formatSaleRates(sale, products)}
                              </div>
                            </div>
                          </div>

                          <div className="self-end sm:self-auto flex items-baseline gap-1 text-right text-lg sm:text-xl font-extrabold shrink-0">
                            <span className="text-ink-400">=</span>
                            <span className="text-emerald-700">{currencyINR(sale.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <RecordRetailSaleModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <StartRetailDayModal
        open={startModalOpen}
        onClose={() => setStartModalOpen(false)}
        products={trackedActiveProducts}
        stockByProduct={todayStockByProduct}
        onStart={handleStartRetail}
        busy={dayActionBusy}
        error={actionError}
      />
      <Modal
        open={finishModalOpen}
        onClose={() => { if (!dayActionBusy) setFinishModalOpen(false); }}
        title="Finish Retail Sales"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-700">
            This will record all stock remaining for today as retail sales at the prices you set. It will also count
            physically unsold items as sold and reduce their inventory balance to zero.
          </p>
          {actionError && <p className="text-sm text-red-700" role="alert">{actionError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setFinishModalOpen(false)} className="btn-ghost">Cancel</button>
            <button type="button" onClick={handleFinishRetail} disabled={dayActionBusy} className="btn-purple">
              {dayActionBusy ? 'Finishing…' : 'Confirm Finish Retail'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
