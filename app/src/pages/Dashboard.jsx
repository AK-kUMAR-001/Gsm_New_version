import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact, getProductEmoji, todayIST } from '../lib/business.js';
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
} from 'lucide-react';

export default function Dashboard() {
  const {
    activeProducts,
    balances,
    products,
    today,
    recent,
    inventorySettings,
    inventoryCounts,
    inventoryLoading,
    loadInventory,
    offline,
  } = useAppData();

  const [saleOpen, setSaleOpen] = useState(false);
  const [retailOpen, setRetailOpen] = useState(false);

  useEffect(() => {
    if (!offline) loadInventory();
  }, [loadInventory, offline]);

  const missingStockCounts = inventorySettings.filter(
    (setting) => !inventoryCounts.some((count) => count.product_id === setting.product_id && count.stock_date === todayIST()),
  );

  const topOutstanding = balances.list
    .filter((b) => b.balance_due > 0)
    .sort((a, b) => b.balance_due - a.balance_due)
    .slice(0, 5);

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

      {inventorySettings.length > 0 && (
        <Link
          to="/inventory"
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
            missingStockCounts.length > 0
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-green-200 bg-green-50 text-green-900'
          }`}
        >
          {missingStockCounts.length > 0
            ? <AlertTriangle className="w-5 h-5 shrink-0" />
            : <CheckCircle2 className="w-5 h-5 shrink-0" />}
          <span className="flex-1 text-sm font-semibold">
            {inventoryLoading
              ? 'Checking today’s stock counts…'
              : missingStockCounts.length > 0
                ? `${missingStockCounts.length} tracked product${missingStockCounts.length === 1 ? '' : 's'} need a physical count before sale.`
                : 'Today’s physical stock counts are complete.'}
          </span>
          <ChevronRight className="w-4 h-4 shrink-0" />
        </Link>
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
            <button
              aria-label="Refresh"
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-400"
            >
              <RefreshCw className="w-4 h-4" />
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
              const buyerOrProduct = r.buyer_name ? r.buyer_name : 'Retail';
              const extra = r.product ? `· ${r.product}` : '';
              return (
                <div
                  key={`${r.type}-${r.id}`}
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
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-900 truncate">
                      {r.type === 'PAYMENT' ? 'Payment · ' : ''}
                      {buyerOrProduct}
                      {r.product && r.buyer_name ? <span className="text-ink-500 font-normal"> · {r.product}</span> : null}
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
    </div>
  );
}
