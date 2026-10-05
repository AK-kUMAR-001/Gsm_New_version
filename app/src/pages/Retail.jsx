import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, todayIST, formatDateCompact, getProductEmoji, inPeriod } from '../lib/business.js';
import Avatar from '../components/Avatar.jsx';
import Modal from '../components/Modal.jsx';
import PeriodPills, { RETAIL_PERIOD_OPTIONS } from '../components/PeriodPills.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import { ArrowLeft, Plus, RefreshCw, TrendingUp, IndianRupee, Package, ShoppingBag, Calendar, FileText, ChevronRight, Banknote } from 'lucide-react';

export default function Retail() {
  const { retailSales, products, filterByPeriod, load } = useAppData();

  const [period, setPeriod] = useState('week');
  const [modalOpen, setModalOpen] = useState(false);

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

      <div className="metric-card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-50 text-ink-500">
                <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Date</th>
                <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Product</th>
                <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Mootais Sold</th>
                <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Price/Mootai</th>
                <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Total</th>
                <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center text-ink-400">
                      <Package className="w-10 h-10 mb-3 opacity-50" />
                      <div className="font-semibold text-ink-600 mb-1">No retail sales yet</div>
                      <div className="text-sm">Record a retail sale to get started.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((s) => {
                  const qty = s.mootais_sold ?? s.mootais ?? 0;
                  const rate = s.price_per_mootai ?? 0;
                  const total = qty * rate;
                  return (
                    <tr key={s.id} className="border-t border-ink-100 hover:bg-ink-50/50 transition">
                      <td className="px-5 py-4 whitespace-nowrap text-ink-600">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-ink-400" />
                          {formatDateCompact(s.sale_date)}
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">{getProductEmoji(s.product, products)}</span>
                          <span className="font-semibold text-ink-800">{s.product || '(Unknown)'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right text-ink-700 font-semibold">{qty}</td>
                      <td className="px-5 py-4 text-right text-ink-600">{currencyINR(rate)}</td>
                      <td className="px-5 py-4 text-right font-bold text-ink-900">{currencyINR(total)}</td>
                      <td className="px-5 py-4 text-ink-500 max-w-[240px] truncate" title={s.notes || ''}>
                        {s.notes ? <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />{s.notes}</span> : <span className="text-ink-300">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RecordRetailSaleModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
