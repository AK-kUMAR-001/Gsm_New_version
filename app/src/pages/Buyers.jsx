import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact } from '../lib/business.js';
import AddBuyerModal from '../components/AddBuyerModal.jsx';
import QuickBuyerEntryModal from '../components/QuickBuyerEntryModal.jsx';
import RecordPaymentModal from '../components/RecordPaymentModal.jsx';
import Avatar from '../components/Avatar.jsx';
import {
  IndianRupee,
  Plus,
  TrendingDown,
  TrendingUp,
  Users,
  CreditCard,
  Phone,
  MapPin,
  ArrowRight,
  ChevronDown,
  Search,
  SortAsc,
  SortDesc,
  Receipt,
  HandCoins,
  AlertCircle,
  Archive,
} from 'lucide-react';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'cleared', label: 'Cleared' },
];

const SORTS = [
  { key: 'due_desc', label: 'Highest Due first' },
  { key: 'activity_asc', label: 'Oldest activity first' },
  { key: 'due_asc', label: 'Lowest Due' },
  { key: 'az', label: 'A-Z' },
];

function latestBuyerActivity(buyer) {
  const dates = [buyer.last_purchase, buyer.last_payment].filter(Boolean).map((date) => String(date).slice(0, 10));
  return dates.length ? dates.sort().at(-1) : null;
}

export default function Buyers() {
  const { activeBuyers, buyersById, balances } = useAppData();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('due_desc');
  const [addOpen, setAddOpen] = useState(false);
  const [saleBuyerId, setSaleBuyerId] = useState(null);
  const [paymentBuyerId, setPaymentBuyerId] = useState(null);

  const q = query.trim().toLowerCase();
  const activeBalanceList = useMemo(
    () => balances.list.filter((buyer) => !buyersById[buyer.id]?.archived_at),
    [balances.list, buyersById]
  );
  const activeBalanceSummary = useMemo(() => activeBalanceList.reduce((summary, buyer) => {
    if (buyer.balance_due > 0) {
      summary.outstandingCount += 1;
      summary.outstandingTotal += buyer.balance_due;
    } else {
      summary.clearedCount += 1;
    }
    return summary;
  }, { outstandingCount: 0, outstandingTotal: 0, clearedCount: 0 }), [activeBalanceList]);

  const list = useMemo(() => {
    let rows = activeBalanceList;
    if (q) {
      rows = rows.filter((b) => {
        const name = String(b.name || '').toLowerCase();
        const phone = String(b.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
    }
    if (filter === 'outstanding') rows = rows.filter((b) => b.balance_due > 0);
    if (filter === 'cleared') rows = rows.filter((b) => b.balance_due === 0);
    const sorted = [...rows];
    if (sort === 'due_desc') sorted.sort((a, b) => b.balance_due - a.balance_due);
    if (sort === 'due_asc') sorted.sort((a, b) => a.balance_due - b.balance_due);
    if (sort === 'activity_asc') {
      sorted.sort((a, b) => (latestBuyerActivity(a) || '9999-12-31').localeCompare(latestBuyerActivity(b) || '9999-12-31'));
    }
    if (sort === 'az') sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return sorted;
  }, [activeBalanceList, q, filter, sort]);

  return (
    <div className="space-y-6">
      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="metric-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-500">Total Buyers</div>
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{activeBuyers.length}</div>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-sidebar-accent/10 flex items-center justify-center text-sidebar-accent">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-ink-500">
            <Users className="w-3.5 h-3.5" />
            Registered
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-500">Outstanding</div>
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{activeBalanceSummary.outstandingCount}</div>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-600">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-amber-600">
            <TrendingDown className="w-3.5 h-3.5" />
            Pending dues
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-500">Cleared</div>
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{activeBalanceSummary.clearedCount}</div>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-brand-green/15 flex items-center justify-center text-green-700">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-green">
            <TrendingUp className="w-3.5 h-3.5" />
            Fully paid
          </div>
        </div>

        <div className="metric-card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink-500">Total Due</div>
              <div className="mt-2 break-words text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
                {currencyINR(activeBalanceSummary.outstandingTotal)}
              </div>
            </div>
            <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-purple/10 text-brand-purple sm:flex">
              <IndianRupee className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-brand-purple">
            <TrendingDown className="w-3.5 h-3.5" />
            To collect
          </div>
        </div>
      </div>

      {/* Top Bar: Search, Filter Pills, Sort, Add Button */}
      <div className="bg-white rounded-3xl border border-ink-100 shadow-card p-4 md:p-5">
        <div className="flex flex-col xl:flex-row xl:items-center gap-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or phone…"
              className="input !pl-12 pr-4"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`filter-pill ${filter === f.key ? 'active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full xl:w-56 shrink-0">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input appearance-none !pr-11 !pl-12"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
              {sort === 'az' || sort === 'due_asc' ? (
                <SortAsc className="w-4 h-4 text-ink-400" />
              ) : (
                <SortDesc className="w-4 h-4 text-ink-400" />
              )}
            </div>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
          </div>

          <Link to="/buyers/deleted" className="btn-outline lg:!px-5 min-h-[44px]">
            <Archive className="w-4 h-4" />
            Archived Customers
          </Link>
          <button
            onClick={() => setAddOpen(true)}
            className="btn-green lg:!px-5 min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Add Buyer
          </button>
        </div>
      </div>

      {/* Buyer Card Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5">
        {list.length === 0 && (
          <div className="col-span-full bg-white rounded-3xl border border-ink-100 shadow-card p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-ink-400" />
            </div>
            <h3 className="text-lg font-bold text-ink-900">No buyers found</h3>
            <p className="text-sm text-ink-500 mt-1">
              {query || filter !== 'all'
                ? 'Try changing the search or filter.'
                : 'Add your first buyer to get started.'}
            </p>
            {!query && filter === 'all' && (
              <button
                onClick={() => setAddOpen(true)}
                className="btn-green mt-5"
              >
                <Plus className="w-4 h-4" />
                Add First Buyer
              </button>
            )}
          </div>
        )}

        {list.map((b) => {
          const due = b.balance_due > 0;
          const hasCredit = b.credit_balance > 0;
          return (
            <div
              key={b.id}
              className="buyer-card min-w-0 bg-white rounded-3xl border border-ink-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200"
            >
              {/* Header: Avatar + Name + Phone */}
              <div className="flex items-start gap-3.5">
                <Avatar name={b.name} sizeClass="w-12 h-12 text-base" ring />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-ink-900 truncate">{b.name}</h3>
                    {due ? (
                      <span className="pill !text-[10px] !py-0.5 !px-2 bg-amber-500/10 text-amber-700">
                        Due
                      </span>
                    ) : hasCredit ? (
                      <span className="pill !text-[10px] !py-0.5 !px-2 bg-sky-500/10 text-sky-700">
                        Credit
                      </span>
                    ) : (
                      <span className="pill !text-[10px] !py-0.5 !px-2 bg-brand-green/15 text-green-700">
                        Cleared
                      </span>
                    )}
                  </div>
                  {b.phone && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                      <Phone className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{b.phone}</span>
                    </div>
                  )}
                  {b.address && (
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-ink-500">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{b.address}</span>
                    </div>
                  )}
                  {due && (
                    <div className="mt-1 text-xs text-amber-800">
                      Latest sale or payment: {latestBuyerActivity(b) ? formatDateCompact(latestBuyerActivity(b)) : 'No activity date'}
                    </div>
                  )}
                </div>
              </div>

              {/* 2 Mini Metrics (actually 3 values in 2 cards: Purchases + Paid + Due) */}
              <div className="buyer-metrics mt-5 grid grid-cols-2 min-[420px]:grid-cols-4 gap-2">
                <div className="min-w-0 overflow-hidden bg-ink-50 rounded-2xl px-2 py-3">
                  <div className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
                    Purchases
                  </div>
                  <div className="buyer-metric-value mt-1 whitespace-nowrap text-xs font-extrabold tracking-tight text-ink-900" title={currencyINR(b.total_sales)}>
                    {currencyINR(b.total_sales)}
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden bg-brand-green/10 rounded-2xl px-2 py-3">
                  <div className="truncate text-[10px] font-bold uppercase tracking-wider text-green-700">
                    Paid
                  </div>
                  <div className="buyer-metric-value mt-1 whitespace-nowrap text-xs font-extrabold tracking-tight text-green-800" title={currencyINR(b.total_paid)}>
                    {currencyINR(b.total_paid)}
                  </div>
                </div>
                <div
                  className={`min-w-0 overflow-hidden rounded-2xl px-2 py-3 ${
                    due ? 'bg-amber-500/10' : 'bg-ink-50'
                  }`}
                >
                  <div
                    className={`truncate text-[10px] font-bold uppercase tracking-wider ${
                      due ? 'text-amber-700' : 'text-ink-500'
                    }`}
                  >
                    Due
                  </div>
                  <div
                    className={`buyer-metric-value mt-1 whitespace-nowrap text-xs font-extrabold tracking-tight ${
                      due ? 'text-amber-800' : 'text-ink-700'
                    }`}
                    title={currencyINR(b.balance_due)}
                  >
                    {currencyINR(b.balance_due)}
                  </div>
                </div>
                <div className={`min-w-0 overflow-hidden rounded-2xl px-2 py-3 ${hasCredit ? 'bg-sky-500/10' : 'bg-ink-50'}`}>
                  <div className={`truncate text-[10px] font-bold uppercase tracking-wider ${hasCredit ? 'text-sky-700' : 'text-ink-500'}`}>
                    Credit
                  </div>
                  <div className={`buyer-metric-value mt-1 whitespace-nowrap text-xs font-extrabold tracking-tight ${hasCredit ? 'text-sky-800' : 'text-ink-700'}`} title={currencyINR(b.credit_balance)}>
                    {currencyINR(b.credit_balance)}
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Link
                  to={`/buyers/${b.id}`}
                  className="btn-outline !py-2 !px-2 text-xs"
                >
                  Details
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => setSaleBuyerId(b.id)}
                  className="btn-purple !py-2 !px-2 text-xs"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  Sale
                </button>
                <button
                  onClick={() => setPaymentBuyerId(b.id)}
                  className="btn-green !py-2 !px-2 text-xs"
                >
                  <HandCoins className="w-3.5 h-3.5" />
                  Payment
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AddBuyerModal open={addOpen} onClose={() => setAddOpen(false)} />
      <QuickBuyerEntryModal
        open={!!saleBuyerId}
        onClose={() => setSaleBuyerId(null)}
        buyerId={saleBuyerId}
      />
      <RecordPaymentModal
        open={!!paymentBuyerId}
        onClose={() => setPaymentBuyerId(null)}
        buyerId={paymentBuyerId}
      />
    </div>
  );
}
