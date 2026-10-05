import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact, getProductEmoji } from '../lib/business.js';
import RecordSaleModal from '../components/RecordSaleModal.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import {
  IndianRupee,
  Users,
  Receipt,
  HandCoins,
  Store,
  ArrowRight,
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
    today,
    recent,
  } = useAppData();

  const [saleOpen, setSaleOpen] = useState(false);
  const [retailOpen, setRetailOpen] = useState(false);

  const topOutstanding = balances.list
    .filter((b) => b.balance_due > 0)
    .sort((a, b) => b.balance_due - a.balance_due)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight">GSM Traders</h1>
        <p className="text-sm text-ink-500 mt-0.5">Ukkadam Market, Coimbatore</p>
      </div>

      {/* Total Buyer Credit Pending (Hero) */}
      <div
        className="rounded-2xl p-6 text-white shadow-lg"
        style={{
          background: 'linear-gradient(135deg, #0f3460 0%, #123b6e 100%)',
        }}
      >
        <div className="text-xs font-bold uppercase tracking-widest text-white/60">
          Total Buyer Credit Pending
        </div>
        <div className="mt-2 text-4xl md:text-5xl font-black tracking-tight">
          {currencyINR(balances.outstanding_total)}
        </div>
        <div className="mt-1 text-sm text-white/70">
          Amount to collect from all buyers
        </div>
      </div>

      {/* 4 Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
            Today — Buyers
          </div>
          <div className="mt-2 text-2xl font-extrabold text-brand-green-dark">
            {currencyINR(today.buyers)}
          </div>
          <div className="mt-1 text-xs text-ink-500">Billed today</div>
        </div>
        <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
            Today — Retail
          </div>
          <div className="mt-2 text-2xl font-extrabold text-brand-purple">
            {currencyINR(today.retail)}
          </div>
          <div className="mt-1 text-xs text-ink-500">Retail income</div>
        </div>
        <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              Today — Total
            </div>
            <ChevronRight className="w-4 h-4 text-ink-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-sidebar-accent">
            {currencyINR(today.total)}
          </div>
          <div className="mt-1 text-xs text-ink-500">Buyers + retail combined</div>
        </div>
        <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">
              Buyers with Dues
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-amber-600">
            {balances.outstanding_count}
          </div>
          <div className="mt-1 text-xs text-ink-500">Owing money right now</div>
        </div>
      </div>

      {/* 2-Column Layout: Actions + Outstanding (left) / Recent Activity (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Action Tiles */}
          <button
            onClick={() => setSaleOpen(true)}
            className="w-full text-left rounded-2xl p-4 text-white shadow-md transition hover:opacity-95 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #0f3460 0%, #123b6e 100%)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-bold">Buyer Sale / Payment</div>
                <div className="text-xs text-white/70 mt-0.5">Record credit sales &amp; collections</div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/70" />
            </div>
          </button>

          <button
            onClick={() => setRetailOpen(true)}
            className="w-full text-left rounded-2xl p-4 text-white shadow-md transition hover:opacity-95 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #7200c0 0%, #8200da 100%)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Store className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-bold">Retail Sale</div>
                <div className="text-xs text-white/70 mt-0.5">Walk-in / cash sale</div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/70" />
            </div>
          </button>

          {/* Top Outstanding Buyers */}
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
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
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden flex flex-col">
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
          <div className="divide-y divide-ink-50 max-h-[560px] overflow-y-auto">
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
                      <Leaf className="w-4 h-4" />
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

      <RecordSaleModal
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
