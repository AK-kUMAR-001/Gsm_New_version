import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR } from '../lib/business.js';
import AddBuyerModal from '../components/AddBuyerModal.jsx';
import RecordSaleModal from '../components/RecordSaleModal.jsx';
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
} from 'lucide-react';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'cleared', label: 'Cleared' },
];

const SORTS = [
  { key: 'due_desc', label: 'Highest Due first' },
  { key: 'due_asc', label: 'Lowest Due' },
  { key: 'az', label: 'A-Z' },
];

export default function Buyers() {
  const { buyers, balances } = useAppData();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('due_desc');
  const [addOpen, setAddOpen] = useState(false);
  const [saleBuyerId, setSaleBuyerId] = useState(null);
  const [paymentBuyerId, setPaymentBuyerId] = useState(null);

  const q = query.trim().toLowerCase();

  const list = useMemo(() => {
    let rows = balances.list;
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
    if (sort === 'az') sorted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return sorted;
  }, [balances.list, q, filter, sort]);

  return (
    <div className="space-y-6">
      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="metric-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-500">Total Buyers</div>
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{buyers.length}</div>
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
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{balances.outstanding_count}</div>
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
              <div className="mt-2 text-3xl font-extrabold text-ink-900">{balances.cleared_count}</div>
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
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-500">Total Due</div>
              <div className="mt-2 text-3xl font-extrabold text-ink-900 tracking-tight">
                {currencyINR(balances.outstanding_total)}
              </div>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-brand-purple/10 flex items-center justify-center text-brand-purple">
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
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or phone…"
              className="input pl-12 pr-4"
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

          <div className="relative w-full lg:min-w-[220px] shrink-0">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input appearance-none pr-11 pl-12"
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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
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
          return (
            <div
              key={b.id}
              className="bg-white rounded-3xl border border-ink-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200"
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
                </div>
              </div>

              {/* 2 Mini Metrics (actually 3 values in 2 cards: Purchases + Paid + Due) */}
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="bg-ink-50 rounded-2xl px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                    Purchases
                  </div>
                  <div className="mt-1 text-sm font-extrabold text-ink-900">
                    {currencyINR(b.total_sales)}
                  </div>
                </div>
                <div className="bg-brand-green/10 rounded-2xl px-3 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-green-700">
                    Paid
                  </div>
                  <div className="mt-1 text-sm font-extrabold text-green-800">
                    {currencyINR(b.total_paid)}
                  </div>
                </div>
                <div
                  className={`rounded-2xl px-3 py-3 ${
                    due ? 'bg-amber-500/10' : 'bg-ink-50'
                  }`}
                >
                  <div
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      due ? 'text-amber-700' : 'text-ink-500'
                    }`}
                  >
                    Due
                  </div>
                  <div
                    className={`mt-1 text-sm font-extrabold ${
                      due ? 'text-amber-800' : 'text-ink-700'
                    }`}
                  >
                    {currencyINR(b.balance_due)}
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

      {/* Floating Add Buyer Button (mobile friendly backup) */}
      <button
        onClick={() => setAddOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-2xl bg-brand-green hover:bg-brand-green-dark text-sidebar-accent shadow-2xl flex items-center justify-center transition-all active:scale-95"
        aria-label="Add Buyer"
      >
        <Plus className="w-6 h-6" />
      </button>

      <AddBuyerModal open={addOpen} onClose={() => setAddOpen(false)} />
      <RecordSaleModal
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
