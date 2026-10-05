import React, { useState, useMemo } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, getProductEmoji, buildMonthlyBuckets } from '../lib/business.js';
import PeriodPills from '../components/PeriodPills.jsx';
import { IndianRupee } from 'lucide-react';

function sumSales(sales) {
  let total = 0;
  for (const s of sales || []) {
    const q = s.mootais ?? s.mootais_sold ?? 0;
    const r = s.price_per_mootai ?? 0;
    total += Number(q || 0) * Number(r || 0);
  }
  return Math.round(total);
}

function BuyerRetailChart({ data }) {
  if (!data || data.length === 0) return null;

  const width = 720;
  const height = 260;
  const paddingTop = 20;
  const paddingRight = 24;
  const paddingBottom = 48;
  const paddingLeft = 56;
  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const maxValue = Math.max(1, ...data.flatMap((d) => [d.buyers, d.retail, d.buyers + d.retail]));
  const niceMax = (() => {
    const step = 1500000;
    const next = Math.ceil(maxValue / step) * step;
    return Math.max(next, step);
  })();
  const gridLines = 4;

  const groupCount = data.length || 1;
  const groupWidth = chartW / groupCount;
  const innerGap = 8;
  const barWidth = Math.max(14, Math.min(36, (groupWidth - innerGap - 24) / 2));

  const yTick = (i) => paddingTop + chartH - (i / gridLines) * chartH;
  const yValue = (i) => Math.round((i / gridLines) * niceMax);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const y = yTick(i);
        const v = yValue(i);
        return (
          <g key={`grid-${i}`}>
            <line
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={paddingLeft - 10}
              y={y + 4}
              textAnchor="end"
              className="fill-ink-400"
              style={{ fontSize: '11px' }}
            >
              {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            </text>
          </g>
        );
      })}

      {data.map((d, gi) => {
        const groupCenterX = paddingLeft + gi * groupWidth + groupWidth / 2;
        const buyerH = d.buyers > 0 ? (d.buyers / niceMax) * chartH : 0;
        const retailH = d.retail > 0 ? (d.retail / niceMax) * chartH : 0;
        const buyerY = paddingTop + chartH - buyerH;
        const retailY = paddingTop + chartH - retailH;
        const buyerX = groupCenterX - barWidth - innerGap / 2;
        const retailX = groupCenterX + innerGap / 2;

        return (
          <g key={`bar-${gi}`}>
            {d.buyers > 0 && (
              <rect
                x={buyerX}
                y={buyerY}
                width={barWidth}
                height={buyerH}
                rx="4"
                fill="#10a964"
              />
            )}
            {d.retail > 0 && (
              <rect
                x={retailX}
                y={retailY}
                width={barWidth}
                height={Math.max(retailH, 2)}
                rx="4"
                fill="#8200da"
              />
            )}
            <text
              x={groupCenterX}
              y={height - paddingBottom + 22}
              textAnchor="middle"
              className="fill-ink-500 font-medium"
              style={{ fontSize: '12px' }}
            >
              {d.label}
            </text>
          </g>
        );
      })}

      <line
        x1={paddingLeft}
        y1={paddingTop + chartH}
        x2={width - paddingRight}
        y2={paddingTop + chartH}
        stroke="#c4cad4"
        strokeWidth="1.5"
      />
    </svg>
  );
}

const TOP_BUYER_CARDS = [
  {
    rank: 1,
    badgeBg: 'bg-amber-500 text-white',
    cardBg: 'bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100/60',
    cardBorder: 'border-amber-200',
    pendingColor: 'text-amber-800',
    textMain: 'text-ink-900',
  },
  {
    rank: 2,
    badgeBg: 'bg-slate-500 text-white',
    cardBg: 'bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100/60',
    cardBorder: 'border-slate-200',
    pendingColor: 'text-slate-700',
    textMain: 'text-ink-900',
  },
  {
    rank: 3,
    badgeBg: 'bg-amber-700 text-white',
    cardBg: 'bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100/60',
    cardBorder: 'border-orange-200',
    pendingColor: 'text-orange-800',
    textMain: 'text-ink-900',
  },
];

function topBuyersForPeriod(buyerSalesInPeriod, buyerBalances) {
  const byBuyer = new Map();
  for (const s of buyerSalesInPeriod || []) {
    const id = s.buyer_id;
    if (!id) continue;
    if (!byBuyer.has(id)) byBuyer.set(id, { buyer_id: id, total_revenue: 0, total_mootais: 0 });
    const row = byBuyer.get(id);
    const q = s.mootais ?? s.mootais_sold ?? 0;
    const r = s.price_per_mootai ?? 0;
    row.total_revenue += Number(q || 0) * Number(r || 0);
    row.total_mootais += Number(q || 0);
  }
  const balancesById = new Map();
  for (const b of buyerBalances?.list || []) balancesById.set(b.id, b);
  const list = Array.from(byBuyer.values())
    .map((row) => {
      const bal = balancesById.get(row.buyer_id);
      return {
        ...row,
        name: bal?.name || bal?.buyer_obj?.name || '(Unknown)',
        pending: bal?.balance_due ?? 0,
      };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue);
  return list;
}

export default function Reports() {
  const [period, setPeriod] = useState('week');
  const app = useAppData();
  const { buyerSales, retailSales, products, balances, filterByPeriod } = app;

  const filteredBuyerSales = useMemo(
    () => filterByPeriod(buyerSales, period, 'sale_date'),
    [filterByPeriod, buyerSales, period]
  );
  const filteredRetailSales = useMemo(
    () => filterByPeriod(retailSales, period, 'sale_date'),
    [filterByPeriod, retailSales, period]
  );

  const totalBuyer = useMemo(() => sumSales(filteredBuyerSales), [filteredBuyerSales]);
  const totalRetail = useMemo(() => sumSales(filteredRetailSales), [filteredRetailSales]);
  const combined = totalBuyer + totalRetail;

  const chartData = useMemo(() => {
    const buckets = buildMonthlyBuckets(buyerSales, retailSales, period);
    if (buckets && buckets.length > 0) return buckets;
    const label =
      period === 'week' ? 'This Week' :
      period === 'month' ? 'This Month' :
      period === '3months' ? 'Last 3 Mo' : 'All Time';
    return [{ label, buyers: totalBuyer, retail: totalRetail, total: combined }];
  }, [buyerSales, retailSales, period, totalBuyer, totalRetail, combined]);

  const productRanking = useMemo(() => {
    const agg = new Map();
    const bump = (productName, mootais, revenue) => {
      const k = productName || '(Unknown)';
      if (!agg.has(k)) agg.set(k, { product: k, total_mootais: 0, total_revenue: 0 });
      const e = agg.get(k);
      e.total_mootais += Number(mootais || 0);
      e.total_revenue += Number(revenue || 0);
    };
    for (const s of filteredBuyerSales) {
      const q = s.mootais ?? s.mootais_sold ?? 0;
      const r = s.price_per_mootai ?? 0;
      bump(s.product, q, q * r);
    }
    for (const s of filteredRetailSales) {
      const q = s.mootais_sold ?? s.mootais ?? 0;
      const r = s.price_per_mootai ?? 0;
      bump(s.product, q, q * r);
    }
    return Array.from(agg.values()).sort((a, b) => b.total_revenue - a.total_revenue);
  }, [filteredBuyerSales, filteredRetailSales]);

  const topBuyers = useMemo(
    () => topBuyersForPeriod(filteredBuyerSales, balances),
    [filteredBuyerSales, balances]
  );
  const topBuyerCards = topBuyers.slice(0, 3);
  const topBuyerList = topBuyers.slice(3, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Reports</h1>
      </div>

      <PeriodPills value={period} onChange={setPeriod} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-3xl border border-brand-green/20 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-green-dark">TOTAL</div>
          <div className="mt-2 text-4xl font-black text-brand-green-dark tracking-tight">
            {currencyINR(combined)}
          </div>
        </div>
        <div className="rounded-3xl border border-sidebar-accent/20 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-sidebar-accent">BUYERS</div>
          <div className="mt-2 text-4xl font-black text-sidebar-accent tracking-tight">
            {currencyINR(totalBuyer)}
          </div>
        </div>
        <div className="rounded-3xl border border-brand-purple/20 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-purple">RETAIL</div>
          <div className="mt-2 text-4xl font-black text-brand-purple tracking-tight">
            {currencyINR(totalRetail)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink-900 text-xl mb-4">Buyer vs Retail Revenue</h3>
          <BuyerRetailChart data={chartData} />
          <div className="flex items-center justify-center gap-6 pt-3 text-sm font-semibold">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded-sm bg-[#10a964]" />
              <span className="text-ink-700">Buyers</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded-sm bg-brand-purple" />
              <span className="text-ink-700">Retail</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-ink-900 text-xl mb-4">Sales by Product</h3>
          <div className="divide-y divide-ink-100 max-h-[420px] overflow-y-auto">
            {productRanking.length === 0 && (
              <div className="text-center text-ink-400 text-sm py-10">No sales in this period</div>
            )}
            {productRanking.map((pr) => {
              const emoji = getProductEmoji(pr.product, products);
              return (
                <div
                  key={pr.product}
                  className="flex items-center justify-between gap-3 px-2 py-4"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-3xl shrink-0">{emoji}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-ink-900 text-lg truncate">{pr.product}</div>
                      <div className="text-sm text-ink-500 mt-0.5">{pr.total_mootais} Mootais sold</div>
                    </div>
                  </div>
                  <div className="text-xl font-black text-brand-green-dark shrink-0">
                    {currencyINR(pr.total_revenue)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-ink-900 text-xl mb-5">Top Buyers</h3>

        {topBuyers.length === 0 && (
          <div className="text-center text-ink-500 text-sm py-10">No data for this period</div>
        )}

        {topBuyerCards.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {topBuyerCards.map((b, i) => {
              const style = TOP_BUYER_CARDS[i] || TOP_BUYER_CARDS[2];
              return (
                <div
                  key={b.buyer_id}
                  className={`rounded-3xl border-2 ${style.cardBorder} ${style.cardBg} p-6 text-center shadow-sm`}
                >
                  <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center font-black text-lg ${style.badgeBg}`}>
                    {style.rank}
                  </div>
                  <div className={`mt-3 text-xl font-black ${style.textMain}`}>{b.name}</div>
                  <div className={`mt-1 text-3xl font-black ${style.textMain} tracking-tight`}>
                    {currencyINR(b.total_revenue)}
                  </div>
                  <div className="text-sm text-ink-500 mt-1 font-semibold">
                    {b.total_mootais} Mootais
                  </div>
                  <div className={`mt-2 text-sm font-bold ${style.pendingColor}`}>
                    <IndianRupee className="inline w-3.5 h-3.5 -mt-0.5" />
                    {currencyINR(b.pending).replace(/^₹/, '')} pending
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {topBuyerList.length > 0 && (
          <div className="divide-y divide-ink-100 max-h-[520px] overflow-y-auto">
            {topBuyerList.map((b, i) => {
              const rank = i + 4;
              return (
                <div
                  key={b.buyer_id}
                  className="grid grid-cols-12 items-center gap-3 px-3 py-4"
                >
                  <div className="col-span-2 text-sm font-bold text-ink-500">#{rank}</div>
                  <div className="col-span-4 min-w-0">
                    <div className="text-lg font-black text-ink-900 truncate">{b.name}</div>
                    <div className="text-sm text-ink-500 mt-0.5 font-semibold">{b.total_mootais} Mootais</div>
                  </div>
                  <div className="col-span-3 text-xl font-black text-ink-900 tracking-tight">
                    {currencyINR(b.total_revenue)}
                  </div>
                  <div className="col-span-3 text-right text-sm font-bold text-amber-800">
                    <IndianRupee className="inline w-3.5 h-3.5 -mt-0.5" />
                    {currencyINR(b.pending).replace(/^₹/, '')} pending
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
