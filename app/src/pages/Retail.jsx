import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact, getProductEmoji } from '../lib/business.js';
import PeriodPills, { RETAIL_PERIOD_OPTIONS } from '../components/PeriodPills.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import { Plus, RefreshCw, TrendingUp, Package, ShoppingBag, ChevronRight } from 'lucide-react';

export default function Retail() {
  const { retailSales, products, filterByPeriod, load } = useAppData();

  const [period, setPeriod] = useState('week');
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedDate, setExpandedDate] = useState(null);
  const cardRefs = useRef({});

  const filtered = useMemo(() => {
    return filterByPeriod(retailSales || [], period, 'sale_date').sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));
  }, [retailSales, period, filterByPeriod]);

  const stats = useMemo(() => {
    let revenue = 0;
    let mootais = 0;
    for (const s of filtered) {
      const q = s.mootais_sold ?? s.mootais ?? 0;
      const r = s.price_per_mootai ?? 0;
      revenue += q * r;
      mootais += q;
    }
    return {
      revenue,
      mootais,
      count: filtered.length,
    };
  }, [filtered]);

  const groupedSales = useMemo(() => {
    const map = new Map();

    for (const sale of filtered) {
      const dateKey = (sale.sale_date || '').slice(0, 10);
      if (!dateKey) continue;

      if (!map.has(dateKey)) {
        map.set(dateKey, {
          date: dateKey,
          sales: [],
          totalQty: 0,
          totalRevenue: 0,
        });
      }

      const qty = Number(sale.mootais_sold ?? sale.mootais ?? 0);
      const rate = Number(sale.price_per_mootai ?? 0);
      const total = qty * rate;

      const entry = map.get(dateKey);
      entry.sales.push({ ...sale, qty, rate, total });
      entry.totalQty += qty;
      entry.totalRevenue += total;
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filtered]);

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
              <div className="text-sm font-semibold text-ink-500 uppercase tracking-wide">Total Mootais</div>
              <div className="text-2xl font-extrabold text-ink-900 mt-1">{stats.mootais}</div>
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
                  className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm md:text-base text-ink-700">
                        <span className="font-bold text-ink-900">📅 {formatDateCompact(group.date)}</span>
                        <span className="text-ink-400">·</span>
                        <span>{group.sales.length} sales</span>
                        <span className="text-ink-400">·</span>
                        <span>{group.totalQty} M</span>
                        <span className="text-ink-400">|</span>
                        <span className="font-extrabold text-ink-900">{currencyINR(group.totalRevenue)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center shrink-0">
                    <ChevronRight className={`w-5 h-5 text-ink-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
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
                              <div className="font-semibold text-ink-800 truncate">{sale.product || '(Unknown)'}</div>
                              <div className="text-sm text-ink-500">
                                {sale.qty} M × {currencyINR(sale.rate)} = {currencyINR(sale.total)} {getProductEmoji(sale.product, products)} {sale.product || '(Unknown)'}
                              </div>
                            </div>
                          </div>

                          <div className="text-left sm:text-right text-sm shrink-0">
                            <div className="font-semibold text-ink-700">{sale.qty} M</div>
                            <div className="text-ink-500">{currencyINR(sale.rate)}/M</div>
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
    </div>
  );
}
