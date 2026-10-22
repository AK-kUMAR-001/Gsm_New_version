import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  getProductEmoji,
  buildMonthlyBuckets,
  buildDailyStockClosingRows,
  buildProductPerformance,
  buildRecentActivity,
  computeDailyProductProfits,
  computeInventoryCostReport,
  formatProductQuantities,
  formatSalesQuantityForDate,
  formatSaleQuantities,
  formatSaleRates,
  formatQuantityByUnit,
  inPeriod,
  parseDateStr,
  normalizeStockQuantityInput,
  realTodayIST,
  saleQuantitiesByUnit,
  stockQuantityInputUnits,
} from '../lib/business.js';
import PeriodPills from '../components/PeriodPills.jsx';
import ConfirmDownloadModal from '../components/ConfirmDownloadModal.jsx';
import RecentActivityModal from '../components/RecentActivityModal.jsx';
import QuickBuyerEntryModal from '../components/QuickBuyerEntryModal.jsx';
import RecordPaymentModal from '../components/RecordPaymentModal.jsx';
import RecordRetailSaleModal from '../components/RecordRetailSaleModal.jsx';
import Modal from '../components/Modal.jsx';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, FileDown, FileJson, IndianRupee, Pencil, Search } from 'lucide-react';
import { downloadCsv, downloadJson, exportDateStamp } from '../lib/dataExport.js';

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekDates(dateKeyValue) {
  const date = parseDateStr(dateKeyValue);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date);
    day.setDate(date.getDate() + index);
    return dateKey(day);
  });
}

function formatReportDate(dateKeyValue, options) {
  const date = parseDateStr(dateKeyValue);
  return date.toLocaleDateString('en-IN', options);
}

function entryTime(entry) {
  if (!entry.created_at || !String(entry.created_at).includes('T')) return '';
  const date = new Date(entry.created_at);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function sortEntriesByCreatedAt(entries) {
  return [...entries].sort((a, b) => (
    String(a.created_at || `${a.sale_date || a.paid_at || ''}T00:00:00`)
      .localeCompare(String(b.created_at || `${b.sale_date || b.paid_at || ''}T00:00:00`))
  ));
}

function DailyActivitySection({ title, count, total, emptyText, enterLabel, onEnter, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-bold text-ink-900">{title}</h3>
            {onEnter && (
              <button
                type="button"
                onClick={onEnter}
                className="text-sm font-bold text-red-700 hover:text-red-800"
              >
                {enterLabel}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-500">{count} {count === 1 ? 'entry' : 'entries'}</p>
        </div>
        <div className="shrink-0 text-right text-sm font-extrabold text-ink-900">{currencyINR(total)}</div>
      </div>
      {count === 0 ? (
        <div className="px-4 py-6 text-center sm:px-5">
          <p className="text-sm text-ink-400">{emptyText}</p>
        </div>
      ) : (
        <div className="max-h-[420px] divide-y divide-ink-100 overflow-y-auto px-4 sm:px-5">
          {children}
        </div>
      )}
    </section>
  );
}

function DailyClosingSummary({
  date,
  buyerSalesTotal,
  retailSalesTotal,
  paymentsTotal,
  receiptCost,
  finalProfit,
  rows,
  offline,
  inventoryError,
  onRequestDownload,
  onEditStock,
  hideStockInAndBalance,
}) {
  return (
    <section className="rounded-3xl border border-ink-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Daily closing report</h2>
          <p className="mt-1 text-sm text-ink-500">{formatReportDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="mt-1 text-xs text-ink-500">
            Balance count is calculated from this date's physical count, sales, and stock changes only. It stays blank if no physical count was recorded; previous-day stock is never carried forward.
          </p>
          {hideStockInAndBalance && (
            <p className="mt-1 text-xs text-ink-500">
              Stock-in and balance count are not displayed for this date. Buyer sales remain unchanged.
            </p>
          )}
        </div>
        <button type="button" onClick={onRequestDownload} className="btn-outline min-h-10 !px-3 !py-2">
          <Download className="h-4 w-4" /> Download balance count CSV
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <ReportCostCard label="Buyer sales" amount={buyerSalesTotal} />
        <ReportCostCard label="Retail sales" amount={retailSalesTotal} />
        <ReportCostCard label="Payments received" amount={paymentsTotal} />
        <ReportCostCard
          label="Stock purchase cost"
          amount={offline || inventoryError || hideStockInAndBalance ? null : receiptCost}
          empty={hideStockInAndBalance}
        />
        <ReportCostCard label="Final profit" amount={offline || inventoryError ? null : finalProfit} />
      </div>
      {!offline && !inventoryError && finalProfit == null && rows.length > 0 && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {rows.some((row) => row.stockShortage)
            ? 'Final profit is unavailable while a tracked product has negative closing stock. Reconcile stock first.'
            : 'Final profit is unavailable because at least one tracked sale does not have a linked stock cost.'}
        </p>
      )}

      {offline || inventoryError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Stock opening and closing quantities are unavailable until the inventory database migration is applied and loaded.
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
          No tracked products yet. Start stock tracking to include opening and closing quantities.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100">
          <table className="w-full min-w-[1140px] text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-4 py-3 font-bold">Morning count</th>
                <th className="px-4 py-3 text-right font-bold">Buyer sold</th>
                <th className="px-4 py-3 text-right font-bold">Retail sold</th>
                <th className="px-4 py-3 text-right font-bold">Damaged</th>
                <th className="px-4 py-3 text-right font-bold">Stock corrections</th>
                <th className="px-4 py-3 text-right font-bold">Balance count</th>
                <th className="px-4 py-3 text-right font-bold">Final profit</th>
                <th className="px-4 py-3 text-right font-bold">Stock-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr key={row.productId}>
                  <td className="px-4 py-3 font-semibold text-ink-900">{row.productName}</td>
                  <td className={`px-4 py-3 ${row.countRecorded ? 'text-green-700' : 'text-amber-700'}`}>
                    {row.countRecorded ? formatProductQuantities(row.product, row.countedQuantity) : 'Count not recorded'}
                  </td>
                  <td className="px-4 py-3 text-right text-red-700">{formatSalesQuantityForDate(row.product, row.buyerSold, date)}</td>
                  <td className="px-4 py-3 text-right text-red-700">{formatSalesQuantityForDate(row.product, row.retailSold, date)}</td>
                  <td className="px-4 py-3 text-right text-amber-800">{formatProductQuantities(row.product, row.damaged)}</td>
                  <td className="px-4 py-3 text-right">{formatProductQuantities(row.product, row.corrections)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.closing < 0 ? 'text-red-700' : ''}`}>
                    {hideStockInAndBalance || !row.countRecorded ? '' : (
                      <div className="flex items-center justify-end gap-2">
                        <span>{formatProductQuantities(row.product, row.closing)}</span>
                        <button
                          type="button"
                          onClick={() => onEditStock(row)}
                          aria-label={`Edit ${row.productName} closing stock`}
                          title="Edit closing stock"
                          className="btn-ghost !p-2"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${row.finalProfit != null && row.finalProfit < 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {row.finalProfit == null ? 'Unavailable' : currencyINR(row.finalProfit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!hideStockInAndBalance && (
                      <Link
                        to={`/inventory?stockAction=receipt&stockProductName=${encodeURIComponent(row.productName)}&stockDate=${date}`}
                        className="btn-outline inline-flex min-h-9 !px-3 !py-1.5 whitespace-nowrap"
                      >
                        Add stock-in
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!offline && !inventoryError && rows.some((row) => !row.countRecorded) && (
        <p className="mt-3 text-xs text-amber-800">
          Balance count is not shown for a product until that date's physical morning count is recorded.
        </p>
      )}
      {!offline && !inventoryError && rows.some((row) => row.closing < 0) && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          Negative stock means sales exceed recorded stock. Reconcile the missing stock before relying on profit figures.
        </p>
      )}
    </section>
  );
}

function EditDailyStockModal({ target, onClose, onSave }) {
  const [quantity, setQuantity] = useState('');
  const [quantityUnit, setQuantityUnit] = useState('');
  const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setQuantity(target ? String(target.row.closing) : '');
    setQuantityUnit(target ? target.row.unit : '');
    setReason('');
    setUnitCost('');
    setBusy(false);
    setError('');
  }, [target]);

  const submit = async (event) => {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      const stockInput = normalizeStockQuantityInput(
        target.row.product,
        Number(quantity),
        quantityUnit || target.row.unit,
        unitCost,
      );
      const result = await onSave({
        productId: target.row.productId,
        date: target.date,
        quantity: stockInput.quantity,
        reason: reason.trim(),
        unitCost: stockInput.unitCost,
      });
      if (result?.error) setError(result.error.message || 'Could not update this stock balance.');
      else onClose();
    } catch (saveError) {
      setError(`Could not update this stock balance: ${saveError.message || 'Unexpected error.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={busy ? () => {} : onClose} title="Edit daily closing stock">
      {target && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-ink-600">
            {target.row.productName} · {formatReportDate(target.date, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="daily-stock-unit">Balance unit</label>
              <select
                id="daily-stock-unit"
                value={quantityUnit || target.row.unit}
                onChange={(event) => setQuantityUnit(event.target.value)}
                className="input"
              >
                {stockQuantityInputUnits(target.row.product).map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="daily-stock-quantity">
                Correct balance ({quantityUnit || target.row.unit})
              </label>
              <input
                id="daily-stock-quantity"
                required
                type="number"
                min="0"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="input"
              />
            </div>
          </div>
          {Number(quantity) > 0 && (
            <p className="text-xs text-ink-500">
              Equivalent: {formatProductQuantities(
                target.row.product,
                normalizeStockQuantityInput(
                  target.row.product,
                  Number(quantity),
                  quantityUnit || target.row.unit,
                ).quantity,
              )}
            </p>
          )}
          <div>
            <label className="label">Reason for correction <span className="text-red-500">*</span></label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="input resize-none"
            />
          </div>
          <div>
            <label className="label">Estimated cost per {quantityUnit || target.row.unit} (optional)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              className="input"
            />
            <p className="mt-1 text-xs text-ink-500">
              Required only when adding stock to a date with no remaining stock value.
            </p>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" disabled={busy} onClick={onClose} className="btn-outline flex-1">Cancel</button>
            <button type="submit" disabled={busy || !quantity || !reason.trim()} className="btn-green flex-1">
              <Check className="h-4 w-4" /> {busy ? 'Saving…' : 'Save stock balance'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ActivityEntry({ title, subtitle, amount, timestamp, emoji, note, onEdit }) {
  return (
    <article className="flex min-w-0 items-start gap-3 py-3.5">
      {emoji && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-50 text-xl">
          {emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink-900">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-ink-500">{subtitle}</div>}
        {note && <div className="mt-1 truncate text-xs text-ink-500">{note}</div>}
        {timestamp && <div className="mt-1 text-xs text-ink-400">{timestamp}</div>}
      </div>
      <div className="shrink-0 text-right text-sm font-bold text-ink-900">{currencyINR(amount)}</div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          title="Edit entry"
          className="btn-ghost !p-2"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </article>
  );
}

function WeekDatePicker({ value, onChange, active }) {
  const dates = getWeekDates(value);
  const today = realTodayIST();
  const firstDate = parseDateStr(dates[0]);
  const nextWeek = new Date(firstDate);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const canGoForward = dateKey(nextWeek) <= today;

  const shiftWeek = (amount) => {
    const shifted = new Date(firstDate);
    shifted.setDate(shifted.getDate() + amount * 7);
    const nextDates = getWeekDates(dateKey(shifted));
    const selectedDay = parseDateStr(value).getDay();
    const selectedIndex = (selectedDay + 6) % 7;
    onChange(nextDates[selectedIndex]);
  };

  return (
    <section className="rounded-3xl border border-ink-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-sidebar-accent" />
          <h2 className="font-bold text-ink-900">Daily activity</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => shiftWeek(-1)}
            className="btn-outline !min-h-10 !px-3 !py-2"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-ink-700">
            {formatReportDate(dates[0], { day: 'numeric', month: 'short' })}
            {' – '}
            {formatReportDate(dates[6], { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => shiftWeek(1)}
            disabled={!canGoForward}
            className="btn-outline !min-h-10 !px-3 !py-2"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {dates.map((day) => {
          const selected = active && day === value;
          const future = day > today;
          return (
            <button
              key={day}
              type="button"
              disabled={future}
              aria-pressed={selected}
              onClick={() => onChange(day)}
              className={`min-w-0 rounded-2xl border px-2 py-2.5 text-center transition ${
                selected
                  ? 'border-sidebar-accent bg-sidebar-accent text-white shadow-sm'
                  : 'border-ink-100 bg-ink-50 text-ink-700 hover:border-sidebar-accent/40 hover:bg-white'
              } ${future ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <span className={`block text-[11px] font-semibold ${selected ? 'text-white/80' : 'text-ink-500'}`}>
                {formatReportDate(day, { weekday: 'short' })}
              </span>
              <span className="mt-0.5 block text-sm font-extrabold">
                {formatReportDate(day, { day: 'numeric' })}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

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

function topBuyersForPeriod(buyerSalesInPeriod, buyerBalances, products) {
  const byBuyer = new Map();
  for (const s of buyerSalesInPeriod || []) {
    const id = s.buyer_id;
    if (!id) continue;
    if (!byBuyer.has(id)) byBuyer.set(id, { buyer_id: id, total_revenue: 0, total_quantities: {} });
    const row = byBuyer.get(id);
    const q = s.mootais ?? s.mootais_sold ?? 0;
    const r = s.price_per_mootai ?? 0;
    row.total_revenue += Number(q || 0) * Number(r || 0);
    for (const [unit, quantity] of Object.entries(saleQuantitiesByUnit(s, products))) {
      row.total_quantities[unit] = (row.total_quantities[unit] || 0) + quantity;
    }
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
  const [viewMode, setViewMode] = useState('period');
  const [selectedDate, setSelectedDate] = useState(realTodayIST);
  const [buyerFilter, setBuyerFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDownload, setConfirmDownload] = useState(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEditTarget, setActivityEditTarget] = useState(null);
  const [entryModal, setEntryModal] = useState(null);
  const [stockEditTarget, setStockEditTarget] = useState(null);
  const app = useAppData();
  const {
    buyerSales, retailSales, payments, buyers, products, balances,
    inventorySettings, inventoryCounts, inventoryMovements,
    inventoryError, loadInventory, offline,
    showToast,
    updateBuyerSale, updateRetailSale, updateBuyerPayment,
    deleteBuyerSale, deleteRetailSale, deleteBuyerPayment,
    setStockQuantityForDate,
  } = app;
  const buyersById = useMemo(
    () => new Map((buyers || []).map((buyer) => [buyer.id, buyer])),
    [buyers]
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const requestDownload = (fileLabel, action) => setConfirmDownload({ fileLabel, action });

  const matchesBuyerSale = (sale) => {
    const buyerName = String(buyersById.get(sale.buyer_id)?.name || '').toLocaleLowerCase();
    const productName = String(sale.product || '').toLocaleLowerCase();
    return (!buyerFilter || sale.buyer_id === buyerFilter)
      && (!productFilter || sale.product === productFilter)
      && (!normalizedSearch || buyerName.includes(normalizedSearch) || productName.includes(normalizedSearch));
  };
  const matchesRetailSale = (sale) => {
    const productName = String(sale.product || '').toLocaleLowerCase();
    return (!productFilter || sale.product === productFilter)
      && (!normalizedSearch || productName.includes(normalizedSearch));
  };
  const matchesPayment = (payment) => {
    const buyerName = String(buyersById.get(payment.buyer_id)?.name || '').toLocaleLowerCase();
    return (!buyerFilter || payment.buyer_id === buyerFilter)
      && (!normalizedSearch || buyerName.includes(normalizedSearch));
  };

  const downloadOverallPdf = async () => {
    try {
      const { downloadOverallReportPdf } = await import('../lib/pdfReports.js');
      downloadOverallReportPdf({
        period,
        totalWholesale: totalBuyer,
        totalRetail,
        inventoryReport,
        productRows: productPerformance,
      });
    } catch (error) {
      showToast(`Could not create PDF: ${error.message || 'Unexpected error.'}`, 'error');
      throw error;
    }
  };

  const downloadAllCustomerPdfs = async () => {
    try {
      const { downloadCustomerStatementsPdf } = await import('../lib/pdfReports.js');
      downloadCustomerStatementsPdf({
        period,
        buyers: app.buyers,
        buyerSales: app.buyerSales,
        payments: app.payments,
        balances,
      });
    } catch (error) {
      showToast(`Could not create PDF: ${error.message || 'Unexpected error.'}`, 'error');
      throw error;
    }
  };

  useEffect(() => {
    if (!offline) loadInventory();
  }, [loadInventory, offline]);

  const filteredBuyerSales = useMemo(
    () => (buyerSales || []).filter((sale) => inPeriod(sale.sale_date, period, 'reports') && matchesBuyerSale(sale)),
    [buyerSales, period, buyerFilter, productFilter, normalizedSearch, buyersById]
  );
  const filteredRetailSales = useMemo(
    () => (retailSales || []).filter((sale) => inPeriod(sale.sale_date, period, 'reports') && matchesRetailSale(sale)),
    [retailSales, period, productFilter, normalizedSearch]
  );
  const dailyBuyerSales = useMemo(
    () => sortEntriesByCreatedAt((buyerSales || []).filter((sale) => String(sale.sale_date || '').slice(0, 10) === selectedDate && matchesBuyerSale(sale))),
    [buyerSales, selectedDate, buyerFilter, productFilter, normalizedSearch, buyersById]
  );
  const dailyRetailSales = useMemo(
    () => sortEntriesByCreatedAt((retailSales || []).filter((sale) => String(sale.sale_date || '').slice(0, 10) === selectedDate && matchesRetailSale(sale))),
    [retailSales, selectedDate, productFilter, normalizedSearch]
  );
  const dailyPayments = useMemo(
    () => sortEntriesByCreatedAt((payments || []).filter((payment) => String(payment.paid_at || '').slice(0, 10) === selectedDate && matchesPayment(payment))),
    [payments, selectedDate, buyerFilter, normalizedSearch, buyersById]
  );
  const dailyActivities = useMemo(
    () => buildRecentActivity(
      dailyBuyerSales,
      dailyPayments,
      Object.fromEntries(buyersById),
      Number.MAX_SAFE_INTEGER,
      dailyRetailSales,
    ),
    [dailyBuyerSales, dailyPayments, buyersById, dailyRetailSales]
  );
  const dailyActivitiesById = useMemo(
    () => new Map(dailyActivities.map((activity) => [`${activity.type}:${activity.id}`, activity])),
    [dailyActivities]
  );
  const canEditDailyEntries = selectedDate >= '2026-10-16';
  const editDailyActivity = (type, id) => {
    const activity = dailyActivitiesById.get(`${type}:${id}`);
    if (!activity) return;
    setActivityEditTarget(activity);
    setActivityOpen(true);
  };
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
  const dailyBuyerTotal = useMemo(() => sumSales(dailyBuyerSales), [dailyBuyerSales]);
  const dailyRetailTotal = useMemo(() => sumSales(dailyRetailSales), [dailyRetailSales]);
  const dailyPaymentsTotal = useMemo(
    () => dailyPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0),
    [dailyPayments]
  );
  const dailyProductProfits = useMemo(
    () => computeDailyProductProfits(
      inventorySettings,
      inventoryMovements,
      products,
      buyerSales,
      retailSales,
      selectedDate,
    ),
    [inventorySettings, inventoryMovements, products, buyerSales, retailSales, selectedDate]
  );
  const dailyStockClosingRows = useMemo(
    () => buildDailyStockClosingRows(
      inventorySettings,
      inventoryMovements,
      inventoryCounts,
      products,
      selectedDate,
    ).map((row) => ({
      ...row,
      finalProfit: dailyProductProfits.get(row.productId)?.finalProfit ?? null,
      stockShortage: dailyProductProfits.get(row.productId)?.stockShortage ?? false,
    }))
      .filter((row) => !productFilter || products.find((product) => product.id === row.productId)?.name === productFilter),
    [inventorySettings, inventoryMovements, inventoryCounts, products, selectedDate, productFilter, dailyProductProfits]
  );
  const dailyFinalProfit = dailyStockClosingRows.length > 0
    && dailyStockClosingRows.every((row) => row.finalProfit != null)
    ? dailyStockClosingRows.reduce((sum, row) => sum + row.finalProfit, 0)
    : null;
  const dailyReceiptCost = useMemo(
    () => inventoryMovements
      .filter((movement) => {
        const productName = products.find((product) => product.id === movement.product_id)?.name;
        return movement.movement_date === selectedDate
          && movement.movement_type === 'receipt'
          && (!productFilter || productName === productFilter);
      })
      .reduce((sum, movement) => sum + Number(movement.cost_delta || 0), 0),
    [inventoryMovements, products, selectedDate, productFilter]
  );

  const downloadBackup = () => {
    const exportedAt = new Date().toISOString();
    downloadJson(`gsm-traders-backup-${exportDateStamp()}.json`, {
      format: 'gsm-traders-backup',
      version: 1,
      exportedAt,
      data: {
        buyers,
        buyerSales,
        retailSales,
        payments,
        products,
        suppliers: app.suppliers,
        inventorySettings,
        inventorySummary: app.inventorySummary,
        inventoryCounts,
        inventoryMovements,
      },
    });
  };

  const downloadDailyClosingCsv = () => {
    const rows = dailyStockClosingRows.map((row) => ({
      date: selectedDate,
      product: row.productName,
      quantity_unit: row.unit,
      morning_count: row.countedQuantity ?? '',
      morning_count_display: row.countRecorded
        ? formatProductQuantities(row.product, row.countedQuantity)
        : '',
      morning_count_recorded: row.countRecorded,
      buyer_sales: row.buyerSold,
      buyer_sales_display: formatSalesQuantityForDate(row.product, row.buyerSold, selectedDate),
      retail_sales: row.retailSold,
      retail_sales_display: formatSalesQuantityForDate(row.product, row.retailSold, selectedDate),
      total_sales: row.sold,
      total_sales_display: formatSalesQuantityForDate(row.product, row.sold, selectedDate),
      damaged_stock: row.damaged,
      damaged_stock_display: formatProductQuantities(row.product, row.damaged),
      stock_corrections: row.corrections,
      stock_corrections_display: formatProductQuantities(row.product, row.corrections),
      balance_count: selectedDate === '2026-10-15' || !row.countRecorded ? '' : row.closing,
      balance_count_display: selectedDate === '2026-10-15' || !row.countRecorded
        ? ''
        : formatProductQuantities(row.product, row.closing),
      final_profit: row.finalProfit ?? '',
      final_profit_available: row.finalProfit != null,
    }));
    downloadCsv(`daily-balance-count-${selectedDate}.csv`, rows);
  };

  const totalBuyer = useMemo(() => sumSales(filteredBuyerSales), [filteredBuyerSales]);
  const totalRetail = useMemo(() => sumSales(filteredRetailSales), [filteredRetailSales]);
  const combined = totalBuyer + totalRetail;
  const periodLabel = period === 'week'
    ? 'This week'
    : period === 'month'
      ? 'This month'
      : period === '3months'
        ? 'Last 3 months'
        : 'All time';

  const filteredMovements = useMemo(
    () => (inventoryMovements || []).filter((movement) => {
      const productName = products.find((product) => product.id === movement.product_id)?.name;
      return inPeriod(movement.movement_date, period, 'reports')
        && (!productFilter || productName === productFilter);
    }),
    [inventoryMovements, products, period, productFilter]
  );
  const inventoryReport = useMemo(
    () => computeInventoryCostReport(
      filteredMovements,
      filteredBuyerSales,
      filteredRetailSales,
      period,
      combined
    ),
    [filteredMovements, filteredBuyerSales, filteredRetailSales, period, combined]
  );
  const productPerformance = useMemo(
    () => buildProductPerformance(filteredBuyerSales, filteredRetailSales, filteredMovements, products),
    [filteredBuyerSales, filteredRetailSales, filteredMovements, products]
  );

  const chartData = useMemo(() => {
    const buckets = buildMonthlyBuckets(filteredBuyerSales, filteredRetailSales, period, 'reports');
    if (buckets && buckets.length > 0) return buckets;
    const label =
      period === 'week' ? 'This Week' :
      period === 'month' ? 'This Month' :
      period === '3months' ? 'Last 3 Mo' : 'All Time';
    return [{ label, buyers: totalBuyer, retail: totalRetail, total: combined }];
  }, [filteredBuyerSales, filteredRetailSales, period, totalBuyer, totalRetail, combined]);

  const topBuyers = useMemo(
    () => topBuyersForPeriod(filteredBuyerSales, balances, products),
    [filteredBuyerSales, balances, products]
  );
  const topBuyerCards = topBuyers.slice(0, 3);
  const topBuyerList = topBuyers.slice(3, 10);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Reports</h1>
            <p className="text-sm text-ink-500 mt-1">Sales use the price entered on each bill.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => requestDownload('the report PDF', downloadOverallPdf)}
              className="btn-navy"
            >
              <FileDown className="w-4 h-4" /> Download report PDF
            </button>
            <button
              type="button"
              onClick={() => requestDownload('all customer bills PDF', downloadAllCustomerPdfs)}
              className="btn-outline"
            >
              <FileDown className="w-4 h-4" /> All customer bills PDF
            </button>
            <button
              type="button"
              onClick={() => requestDownload('the complete data backup (one JSON file)', downloadBackup)}
              className="btn-outline min-h-[44px]"
            >
              <FileJson className="h-4 w-4" /> Download all data backup
            </button>
          </div>
        </div>
      </div>

      <section className="space-y-3 rounded-3xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-ink-900">Choose one report view</h2>
          <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-semibold text-ink-700" role="status">
            {viewMode === 'day'
              ? `Single day · ${formatReportDate(selectedDate, { day: 'numeric', month: 'short', year: 'numeric' })}`
              : `Date range · ${periodLabel}`}
          </span>
        </div>
        <WeekDatePicker
          value={selectedDate}
          active={viewMode === 'day'}
          onChange={(date) => {
            setSelectedDate(date);
            setViewMode('day');
          }}
        />
        <PeriodPills
          value={viewMode === 'period' ? period : ''}
          onChange={(nextPeriod) => {
            setPeriod(nextPeriod);
            setViewMode('period');
          }}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-3xl border border-ink-100 bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="relative min-w-0">
          <span className="label">Search buyer or product</span>
          <Search className="pointer-events-none absolute left-3.5 top-[38px] h-4 w-4 text-ink-400" />
          <input
            id="report-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Type a name or product"
            className="input !pl-10"
          />
        </label>
        <label className="min-w-0">
          <span className="label">Buyer</span>
          <select id="report-buyer-filter" value={buyerFilter} onChange={(event) => setBuyerFilter(event.target.value)} className="input">
            <option value="">All buyers</option>
            {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className="label">Product</span>
          <select id="report-product-filter" value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="input">
            <option value="">All products</option>
            {products.map((product) => <option key={product.id} value={product.name}>{product.name}</option>)}
          </select>
        </label>
        <p className="md:col-span-3 text-xs text-ink-500">
          Buyer filters apply to buyer sales and payments; product filters apply to sales and product reports. Choose either a day or a time range above.
        </p>
      </section>

      {viewMode === 'day' && (
      <>
      <div>
        <h2 className="mb-3 text-lg font-bold text-ink-900">
          Entries for {formatReportDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DailyActivitySection
            title="Buyer sales"
            count={dailyBuyerSales.length}
            total={dailyBuyerTotal}
            emptyText="No buyer sales recorded on this date."
            enterLabel={`Enter data for ${formatReportDate(selectedDate, { day: 'numeric', month: 'short' })}`}
            onEnter={() => setEntryModal('buyer')}
          >
            {dailyBuyerSales.map((sale) => {
              const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
              const rate = Number(sale.price_per_mootai ?? 0);
              const buyerName = buyersById.get(sale.buyer_id)?.name || 'Unknown buyer';
              return (
                <ActivityEntry
                  key={sale.id}
                  title={buyerName}
                  subtitle={`${sale.product || 'Product'} · ${formatSaleQuantities(sale, products)} · ${formatSaleRates(sale, products)}`}
                  amount={quantity * rate}
                  timestamp={entryTime(sale)}
                  emoji={getProductEmoji(sale.product, products)}
                  note={sale.notes}
                  onEdit={canEditDailyEntries ? () => editDailyActivity('SALE', sale.id) : null}
                />
              );
            })}
          </DailyActivitySection>
          <DailyActivitySection
            title="Retail sales"
            count={dailyRetailSales.length}
            total={dailyRetailTotal}
            emptyText="No retail sales recorded on this date."
            enterLabel={`Enter data for ${formatReportDate(selectedDate, { day: 'numeric', month: 'short' })}`}
            onEnter={() => setEntryModal('retail')}
          >
            {dailyRetailSales.map((sale) => {
              const quantity = Number(sale.mootais_sold ?? sale.mootais ?? 0);
              const rate = Number(sale.price_per_mootai ?? 0);
              return (
                <ActivityEntry
                  key={sale.id}
                  title={sale.product || 'Retail sale'}
                  subtitle={`${formatSaleQuantities(sale, products)} · ${formatSaleRates(sale, products)}`}
                  amount={quantity * rate}
                  timestamp={entryTime(sale)}
                  emoji={getProductEmoji(sale.product, products)}
                  note={sale.notes}
                  onEdit={canEditDailyEntries ? () => editDailyActivity('RETAIL', sale.id) : null}
                />
              );
            })}
          </DailyActivitySection>
          <DailyActivitySection
            title="Payments"
            count={dailyPayments.length}
            total={dailyPaymentsTotal}
            emptyText="No payments recorded on this date."
            enterLabel={`Enter data for ${formatReportDate(selectedDate, { day: 'numeric', month: 'short' })}`}
            onEnter={() => setEntryModal('payment')}
          >
            {dailyPayments.map((payment) => (
              <ActivityEntry
                key={payment.id}
                title={buyersById.get(payment.buyer_id)?.name || 'Unknown buyer'}
                subtitle="Buyer payment"
                amount={Number(payment.amount_paid || 0)}
                timestamp={entryTime(payment)}
                note={payment.notes}
                onEdit={canEditDailyEntries ? () => editDailyActivity('PAYMENT', payment.id) : null}
              />
            ))}
          </DailyActivitySection>
        </div>
      </div>

      <RecentActivityModal
        open={activityOpen}
        onClose={() => { setActivityOpen(false); setActivityEditTarget(null); }}
        activities={dailyActivities}
        buyers={buyers}
        products={products}
        onSave={saveActivity}
        onDelete={removeActivity}
        initialActivity={activityEditTarget}
      />

      <QuickBuyerEntryModal
        open={entryModal === 'buyer'}
        onClose={() => setEntryModal(null)}
        initialDate={selectedDate}
      />
      <RecordRetailSaleModal
        open={entryModal === 'retail'}
        onClose={() => setEntryModal(null)}
        initialDate={selectedDate}
      />
      <RecordPaymentModal
        open={entryModal === 'payment'}
        onClose={() => setEntryModal(null)}
        initialDate={selectedDate}
      />
      <EditDailyStockModal
        target={stockEditTarget}
        onClose={() => setStockEditTarget(null)}
        onSave={({ productId, date, quantity, reason, unitCost }) => setStockQuantityForDate(
          productId,
          date,
          quantity,
          reason,
          unitCost,
          window.crypto.randomUUID(),
        )}
      />

      <DailyClosingSummary
        date={selectedDate}
        buyerSalesTotal={dailyBuyerTotal}
        retailSalesTotal={dailyRetailTotal}
        paymentsTotal={dailyPaymentsTotal}
        receiptCost={dailyReceiptCost}
        finalProfit={dailyFinalProfit}
        rows={dailyStockClosingRows}
        offline={offline}
        inventoryError={inventoryError}
        hideStockInAndBalance={selectedDate === '2026-10-15'}
        onEditStock={(row) => setStockEditTarget({ date: selectedDate, row })}
        onRequestDownload={() => requestDownload(`the ${selectedDate} balance count CSV`, downloadDailyClosingCsv)}
      />

      <section>
        <h2 className="mb-3 text-lg font-bold text-ink-900">
          Selected day totals · {formatReportDate(selectedDate, { day: 'numeric', month: 'long', year: 'numeric' })}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-brand-green/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-green-dark">TOTAL</div>
            <div className="mt-2 text-4xl font-black tracking-tight text-brand-green-dark">
              {currencyINR(dailyBuyerTotal + dailyRetailTotal)}
            </div>
          </div>
          <div className="rounded-3xl border border-sidebar-accent/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-sidebar-accent">BUYERS</div>
            <div className="mt-2 text-4xl font-black tracking-tight text-sidebar-accent">
              {currencyINR(dailyBuyerTotal)}
            </div>
          </div>
          <div className="rounded-3xl border border-brand-purple/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-purple">RETAIL</div>
            <div className="mt-2 text-4xl font-black tracking-tight text-brand-purple">
              {currencyINR(dailyRetailTotal)}
            </div>
          </div>
        </div>
      </section>
      </>
      )}

      {viewMode === 'period' && (
      <>
      <section>
        <h2 className="mb-3 text-lg font-bold text-ink-900">Period totals · {periodLabel}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
      </section>

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
          <h3 className="font-bold text-ink-900 text-xl mb-4">Product income by sale type</h3>
          <div className="divide-y divide-ink-100 max-h-[420px] overflow-y-auto">
            {productPerformance.length === 0 && (
              <div className="text-center text-ink-400 text-sm py-10">No sales in this period</div>
            )}
            {productPerformance.map((row) => {
              const emoji = getProductEmoji(row.product, products);
              return (
                <div
                  key={row.product}
                  className="flex flex-col gap-2 px-2 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl shrink-0">{emoji}</span>
                      <div className="font-bold text-ink-900 truncate">{row.product}</div>
                    </div>
                    <div className="text-sm font-bold text-ink-700 shrink-0">
                      Total {currencyINR(row.wholesale_revenue + row.retail_revenue)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-green-50 px-3 py-2">
                      <div className="font-semibold text-green-800">Wholesale</div>
                      <div className="text-ink-600">{formatQuantityByUnit(row.wholesale_quantities)} · {currencyINR(row.wholesale_revenue)}</div>
                    </div>
                    <div className="rounded-xl bg-purple-50 px-3 py-2">
                      <div className="font-semibold text-purple-800">Retail</div>
                      <div className="text-ink-600">{formatQuantityByUnit(row.retail_quantities)} · {currencyINR(row.retail_revenue)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-500">
                    <span>Wastage cost: {currencyINR(row.spoilage_cost)}</span>
                    <span>
                      Profit on tracked sales: {row.stock_shortage
                        ? 'Unavailable — stock shortage'
                        : row.trading_profit == null
                          ? 'Not tracked'
                          : currencyINR(row.trading_profit)}
                    </span>
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
                    {formatQuantityByUnit(b.total_quantities)}
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
                    <div className="text-sm text-ink-500 mt-0.5 font-semibold">{formatQuantityByUnit(b.total_quantities)}</div>
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
      </>
      )}
      <ConfirmDownloadModal
        open={!!confirmDownload}
        fileLabel={confirmDownload?.fileLabel || ''}
        onClose={() => setConfirmDownload(null)}
        onConfirm={() => confirmDownload?.action()}
      />
    </div>
  );
}

function ReportCostCard({ label, amount, empty = false }) {
  return (
    <div className="rounded-2xl bg-ink-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-2 text-xl font-extrabold text-ink-900">
        {empty ? '' : amount == null ? '—' : currencyINR(amount)}
      </div>
    </div>
  );
}
