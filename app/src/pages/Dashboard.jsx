import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  computeDailyProductProfits,
  currencyINR,
  formatDateCompact,
  buildRecentActivity,
  getProductEmoji,
  todayIST,
} from '../lib/business.js';
import QuickBuyerEntryModal from '../components/QuickBuyerEntryModal.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import LowStockAlerts from '../components/LowStockAlerts.jsx';
import {
  Users,
  Store,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Leaf,
  CheckCircle2,
  Pencil,
} from 'lucide-react';
import RecentActivityModal from '../components/RecentActivityModal.jsx';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    activeProducts,
    buyers,
    buyersById,
    balances,
    buyerSales,
    products,
    retailSales,
    payments,
    today,
    recent,
    inventorySettings,
    inventoryCounts,
    inventoryMovements,
    inventoryLoading,
    inventoryError,
    loadInventory,
    offline,
    updateBuyerSale,
    updateRetailSale,
    updateBuyerPayment,
    deleteBuyerSale,
    deleteRetailSale,
    deleteBuyerPayment,
  } = useAppData();

  const [saleOpen, setSaleOpen] = useState(false);
  const [retailOpen, setRetailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEditTarget, setActivityEditTarget] = useState(null);
  const allActivities = useMemo(
    () => buildRecentActivity(buyerSales, payments, buyersById, Number.MAX_SAFE_INTEGER, retailSales),
    [buyerSales, payments, buyersById, retailSales],
  );

  const saveActivity = async (activity, fields) => {
    if (activity.type === 'PAYMENT') {
      return updateBuyerPayment(activity.id, {
        buyer_id: fields.buyer_id,
        amount_paid: Number(fields.amount_paid),
        paid_at: fields.date,
        notes: fields.notes.trim() || null,
      });
    }
    if (activity.type === 'RETAIL') {
      return updateRetailSale(activity.id, {
        product: fields.product,
        mootais_sold: Number(fields.quantity),
        quantity_unit: fields.quantity_unit,
        price_per_mootai: Number(fields.price),
        sale_date: fields.date,
        notes: fields.notes.trim() || null,
      });
    }
    return updateBuyerSale(activity.id, {
      buyer_id: fields.buyer_id,
      product: fields.product,
      mootais: Number(fields.quantity),
      quantity_unit: fields.quantity_unit,
      price_per_mootai: Number(fields.price),
      sale_date: fields.date,
      notes: fields.notes.trim() || null,
    });
  };

  const removeActivity = (activity) => {
    if (activity.type === 'PAYMENT') return deleteBuyerPayment(activity.id);
    if (activity.type === 'RETAIL') return deleteRetailSale(activity.id);
    return deleteBuyerSale(activity.id);
  };

  useEffect(() => {
    if (!offline) loadInventory();
  }, [loadInventory, offline]);

  const missingStockCounts = inventorySettings.filter(
    (setting) => !inventoryCounts.some((count) => count.product_id === setting.product_id && count.stock_date === todayIST()),
  );
  const missingActiveStockCounts = inventorySettings.filter(
    (setting) => activeProducts.some((product) => product.id === setting.product_id)
      && !inventoryCounts.some((count) => count.product_id === setting.product_id && count.stock_date === todayIST()),
  );

  const topOutstanding = balances.list
    .filter((b) => b.balance_due > 0)
    .sort((a, b) => b.balance_due - a.balance_due)
    .slice(0, 5);
  const todayProductProfits = computeDailyProductProfits(
    inventorySettings,
    inventoryMovements,
    products,
    buyerSales,
    retailSales,
    todayIST('dashboard'),
  );
  const todayProfitAvailable = !offline
    && !inventoryLoading
    && !inventoryError
    && inventorySettings.length > 0
    && todayProductProfits.size === inventorySettings.length
    && Array.from(todayProductProfits.values()).every((item) => item.finalProfit != null);
  const todayBuyerProfit = todayProfitAvailable
    ? Array.from(todayProductProfits.values()).reduce((sum, item) => sum + item.buyerProfit, 0)
    : null;
  const todayRetailProfit = todayProfitAvailable
    ? Array.from(todayProductProfits.values()).reduce((sum, item) => sum + item.retailProfit, 0)
    : null;
  const todayFinalProfit = todayProfitAvailable
    ? Array.from(todayProductProfits.values()).reduce((sum, item) => sum + item.finalProfit, 0)
    : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <LowStockAlerts />
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight sm:text-3xl">GSM Traders</h1>
        <p className="mt-0.5 text-sm text-ink-500 sm:text-base">Ukkadam Market, Coimbatore</p>
      </div>

      {/* Total Buyer Credit Pending (Hero) */}
      <div
        className="rounded-2xl p-5 text-white shadow-lg sm:p-6"
        style={{
          background: 'linear-gradient(135deg, #0f3460 0%, #123b6e 100%)',
        }}
      >
        <div className="text-xs font-bold uppercase tracking-widest text-white/60">
          Total Buyer Credit Pending
        </div>
        <div className="mt-2 break-words text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
          {currencyINR(balances.outstanding_total)}
        </div>
        <div className="mt-1 text-sm text-white/70">
          Amount to collect from all buyers
          {balances.customer_credit_total > 0 && (
            <span className="block mt-1 text-sky-200">
              Buyer credit held: {currencyINR(balances.customer_credit_total)}
            </span>
          )}
        </div>
      </div>

      {/* 4 Stats Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm sm:p-4">
          <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500 sm:text-[10px] sm:tracking-widest">
            Today — Buyers
          </div>
          <div className="mt-2 break-words text-xl font-extrabold text-brand-green-dark sm:text-2xl">
            {currencyINR(today.buyers)}
          </div>
          <div className="mt-1 text-[11px] text-ink-500 sm:text-xs">Billed today</div>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm sm:p-4">
          <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500 sm:text-[10px] sm:tracking-widest">
            Today — Retail
          </div>
          <div className="mt-2 break-words text-xl font-extrabold text-brand-purple sm:text-2xl">
            {currencyINR(today.retail)}
          </div>
          <div className="mt-1 text-[11px] text-ink-500 sm:text-xs">Retail income</div>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm sm:p-4">
          <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500 sm:text-[10px] sm:tracking-widest">
            Today — Collections
          </div>
          <div className="mt-2 break-words text-xl font-extrabold text-green-700 sm:text-2xl">
            {currencyINR(today.collections)}
          </div>
          <div className="mt-1 text-[11px] text-ink-500 sm:text-xs">Payments received today</div>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500 sm:text-[10px] sm:tracking-widest">
              Today — Total
            </div>
            <ChevronRight className="w-4 h-4 text-ink-400" />
          </div>
          <div className="mt-2 break-words text-xl font-extrabold text-sidebar-accent sm:text-2xl">
            {currencyINR(today.total)}
          </div>
          <div className="mt-1 text-[11px] text-ink-500 sm:text-xs">Buyers + retail combined</div>
        </div>
        <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500 sm:text-[10px] sm:tracking-widest">
              Buyers with Dues
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 break-words text-xl font-extrabold text-amber-600 sm:text-2xl">
            {balances.outstanding_count}
          </div>
          <div className="mt-1 text-[11px] text-ink-500 sm:text-xs">Owing money right now</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Today — Buyers Profit', value: todayBuyerProfit, color: 'text-blue-800', background: 'border-blue-200 bg-blue-50' },
          { label: 'Today — Retail Profit', value: todayRetailProfit, color: 'text-violet-800', background: 'border-violet-200 bg-violet-50' },
          { label: 'Today — Total Profit', value: todayFinalProfit, color: 'text-emerald-800', background: 'border-emerald-200 bg-emerald-50' },
        ].map((item) => (
          <div key={item.label} className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${item.background}`}>
            <div className="text-xs font-bold uppercase tracking-widest text-ink-600">{item.label}</div>
            <div className={`mt-2 break-words text-2xl font-extrabold sm:text-3xl ${item.value == null ? 'text-ink-500' : item.color}`}>
              {inventoryLoading ? 'Loading…' : item.value == null ? 'Unavailable' : currencyINR(item.value)}
            </div>
            <p className="mt-1 text-xs text-ink-700">
              {inventoryLoading
                ? 'Loading today’s stock costs…'
                : offline
                  ? 'Stock cost data is unavailable while offline.'
                  : inventoryError
                    ? `Stock cost data could not be loaded: ${inventoryError}`
                    : item.value == null
                      ? Array.from(todayProductProfits.values()).some((profit) => profit.stockShortage)
                        ? 'Reconcile negative stock before profit can be calculated.'
                        : 'Profit needs complete linked sale costs for tracked products.'
                      : item.label.includes('Total')
                        ? 'After recorded damage; only recorded sales count as sold.'
                        : 'Sales revenue minus linked stock cost.'}
            </p>
          </div>
        ))}
      </div>

      {inventorySettings.length > 0 && (
        <div
          className={`inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
            missingStockCounts.length > 0
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-green-200 bg-green-50 text-green-900'
          }`}
        >
          <Link to="/inventory" className="flex min-w-0 flex-1 items-center gap-3">
            {missingStockCounts.length > 0
              ? <AlertTriangle className="w-5 h-5 shrink-0" />
              : <CheckCircle2 className="w-5 h-5 shrink-0" />}
            <span className="text-sm font-semibold">
              {inventoryLoading
                ? 'Checking today’s stock counts…'
                : missingStockCounts.length > 0
                  ? `${missingStockCounts.length} tracked product${missingStockCounts.length === 1 ? '' : 's'} need a physical count before sale.`
                  : 'Today’s physical stock counts are complete.'}
            </span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </Link>
          <button
            type="button"
            onClick={() => navigate('/retail?start=1')}
            disabled={inventoryLoading || missingActiveStockCounts.length > 0}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Store className="h-4 w-4" />
            Retail Sales Start
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2 lg:gap-5">
        <div className="order-1 grid grid-cols-2 gap-3 lg:col-start-1 lg:row-start-1 lg:grid-cols-1 lg:self-start">
          <button
            onClick={() => setSaleOpen(true)}
            className="rounded-2xl p-3 text-white shadow-md transition hover:opacity-95 active:scale-[0.99] sm:p-4"
            style={{ background: 'linear-gradient(135deg, #0f3460 0%, #123b6e 100%)' }}
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-start sm:text-left">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold leading-tight sm:text-sm">Buyer Sale / Payment</div>
                <div className="mt-0.5 hidden text-xs text-white/70 sm:block">Named buyer: sale adds to due; record payments separately</div>
              </div>
              <ChevronRight className="hidden h-5 w-5 shrink-0 text-white/70 sm:block" />
            </div>
          </button>

          <button
            onClick={() => setRetailOpen(true)}
            className="rounded-2xl p-3 text-white shadow-md transition hover:opacity-95 active:scale-[0.99] sm:p-4"
            style={{ background: 'linear-gradient(135deg, #7200c0 0%, #8200da 100%)' }}
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-start sm:text-left">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Store className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold leading-tight sm:text-sm">Retail Sale</div>
                <div className="mt-0.5 hidden text-xs text-white/70 sm:block">Walk-in sale not linked to a buyer balance</div>
              </div>
              <ChevronRight className="hidden h-5 w-5 shrink-0 text-white/70 sm:block" />
            </div>
          </button>
        </div>

        <div className="order-3 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm lg:col-start-1 lg:row-start-2">
            <div className="flex items-center gap-2 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-ink-900 text-sm">Top Outstanding Buyers</h3>
            </div>
            <div className="divide-y divide-ink-50">
              {topOutstanding.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-ink-500">
                  No outstanding dues.
                </div>
              )}
              {topOutstanding.map((b) => (
                <Link
                  key={b.id}
                  to={`/buyers/${b.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-ink-50 transition"
                >
                  <span className="text-sm font-semibold text-ink-800 truncate">{b.name}</span>
                  <span className="pill !text-xs !py-0.5 !px-2.5 bg-amber-500/10 text-amber-700 font-bold shrink-0 ml-3">
                    {currencyINR(b.balance_due)}
                  </span>
                </Link>
              ))}
            </div>
        </div>

        <div className="order-2 flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-50">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-ink-500" />
              <h3 className="font-bold text-ink-900 text-sm">Recent Activity</h3>
            </div>
            <button type="button" onClick={() => { setActivityEditTarget(null); setActivityOpen(true); }} className="btn-ghost !px-3 !py-1.5 text-xs">
              View all / Edit
            </button>
          </div>
          <div className="max-h-[560px] divide-y divide-ink-50 overflow-y-auto">
            {recent.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-ink-500">
                No recent activity.
              </div>
            )}
            {recent.map((r) => {
              const isSale = r.type === 'SALE';
              const activityType = r.type === 'PAYMENT' ? 'PAYMENT' : r.type === 'RETAIL' ? 'RETAIL' : 'SALE';
              return (
                <div
                  key={`${activityType}-${r.id}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isSale
                        ? 'bg-brand-green/10 text-green-700'
                        : 'bg-brand-green/15 text-green-700'
                    }`}
                  >
                    {isSale ? (
                      r.product ? (
                        <span className="text-base leading-none">{getProductEmoji(r.product, products)}</span>
                      ) : (
                        <Leaf className="w-4 h-4" />
                      )
                    ) : (
                      activityType === 'PAYMENT' ? <CheckCircle2 className="w-4 h-4" /> : <Leaf className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-900 truncate">
                      {activityType === 'PAYMENT' ? 'Payment · ' : activityType === 'RETAIL' ? 'Retail · ' : ''}
                      {r.buyer_name || 'Retail'}
                      {r.product && r.buyer_name ? <span className="text-ink-500 font-normal"> · {r.product}</span> : null}
                      {r.product && !r.buyer_name && activityType === 'RETAIL' ? <span className="text-ink-500 font-normal"> · {r.product}</span> : null}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {formatDateCompact(r.date)}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-bold shrink-0 ${
                      isSale ? 'text-ink-900' : 'text-green-700'
                    }`}
                  >
                    {isSale ? '' : ''}
                    {currencyINR(r.amount)}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setActivityEditTarget(r); setActivityOpen(true); }}
                    aria-label={`Edit ${activityType.toLowerCase()} record`}
                    title="Edit activity"
                    className="btn-ghost !p-2 shrink-0"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="border-t border-ink-50 px-4 py-3 text-center">
            <Link
              to="/reports"
              className="text-xs font-bold text-sidebar-accent hover:underline inline-flex items-center gap-1"
            >
              View full reports <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      <QuickBuyerEntryModal
        open={saleOpen}
        onClose={() => setSaleOpen(false)}
      />
      <RecordRetailSaleModal
        open={retailOpen}
        onClose={() => setRetailOpen(false)}
      />
      <RecentActivityModal
        open={activityOpen}
        onClose={() => { setActivityOpen(false); setActivityEditTarget(null); }}
        activities={allActivities}
        buyers={buyers}
        products={products}
        onSave={saveActivity}
        onDelete={removeActivity}
        initialActivity={activityEditTarget}
      />
    </div>
  );
}
