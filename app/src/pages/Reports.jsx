import React, { useState, useMemo, useEffect } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  getProductEmoji,
  buildProductPerformance,
  computeInventoryCostReport,
  inPeriod,
  parseDateStr,
  realTodayIST,
} from '../lib/business.js';
import PeriodPills from '../components/PeriodPills.jsx';
import ConfirmDownloadModal from '../components/ConfirmDownloadModal.jsx';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileDown, FileJson, IndianRupee, Search } from 'lucide-react';
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

function buildDailyStockClosingRows(settings, movements, counts, products, date, buyerSales, retailSales) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const countsByProduct = new Map(
    counts.filter((count) => count.stock_date === date).map((count) => [count.product_id, count])
  );
  const salesByProduct = new Map();
  for (const sale of buyerSales) {
    const current = salesByProduct.get(sale.product) || { buyerRevenue: 0, retailRevenue: 0 };
    const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
    current.buyerRevenue += quantity * Number(sale.price_per_mootai ?? 0);
    salesByProduct.set(sale.product, current);
  }
  for (const sale of retailSales) {
    const current = salesByProduct.get(sale.product) || { buyerRevenue: 0, retailRevenue: 0 };
    const quantity = Number(sale.mootais_sold ?? sale.mootais ?? 0);
    current.retailRevenue += quantity * Number(sale.price_per_mootai ?? 0);
    salesByProduct.set(sale.product, current);
  }
  return settings.filter((setting) => {
    const product = productsById.get(setting.product_id);
    return product && product.active !== false;
  }).map((setting) => {
    const product = productsById.get(setting.product_id);
    const productMovements = movements.filter((movement) => movement.product_id === setting.product_id);
    const openingBeforeDate = productMovements
      .filter((movement) => movement.movement_date < date)
      .reduce((sum, movement) => sum + Number(movement.quantity_delta || 0), 0);
    const todaysMovements = productMovements.filter((movement) => movement.movement_date === date);
    const buyerSold = todaysMovements
      .filter((movement) => movement.movement_type === 'sale' && movement.source_kind === 'buyer_sales')
      .reduce((sum, movement) => sum - Number(movement.quantity_delta || 0), 0);
    const retailSold = todaysMovements
      .filter((movement) => movement.movement_type === 'sale' && movement.source_kind === 'retail_sales')
      .reduce((sum, movement) => sum - Number(movement.quantity_delta || 0), 0);
    const damaged = todaysMovements
      .filter((movement) => movement.movement_type === 'spoilage')
      .reduce((sum, movement) => sum - Number(movement.quantity_delta || 0), 0);
    const corrections = todaysMovements
      .filter((movement) => movement.movement_type === 'correction')
      .reduce((sum, movement) => sum + Number(movement.quantity_delta || 0), 0);
    const count = countsByProduct.get(setting.product_id);
    const sold = buyerSold + retailSold;
    const salesRevenue = salesByProduct.get(product?.name) || { buyerRevenue: 0, retailRevenue: 0 };
    return {
      productId: setting.product_id,
      productName: product?.name || 'Unknown product',
      buyerSold,
      buyerRevenue: salesRevenue.buyerRevenue,
      retailSold,
      retailRevenue: salesRevenue.retailRevenue,
      sold,
      damaged,
      corrections,
      balance: openingBeforeDate + todaysMovements.reduce((sum, movement) => sum + Number(movement.quantity_delta || 0), 0),
      countedQuantity: count?.counted_quantity ?? null,
      countRecorded: !!count,
    };
  }).sort((a, b) => a.productName.localeCompare(b.productName));
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function DailyActivitySection({ title, count, total, emptyText, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-bold text-ink-900">{title}</h3>
          <p className="mt-1 text-xs text-ink-500">{count} {count === 1 ? 'entry' : 'entries'}</p>
        </div>
        <div className="shrink-0 text-right text-sm font-extrabold text-ink-900">{currencyINR(total)}</div>
      </div>
      {count === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-400 sm:px-5">{emptyText}</p>
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
  receiptCost,
  rows,
  offline,
  inventoryError,
  onRequestDownload,
}) {
  return (
    <section className="rounded-3xl border border-ink-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Daily closing report</h2>
          <p className="mt-1 text-sm text-ink-500">{formatReportDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="mt-1 text-xs text-ink-500">
            Morning count is the physical stock entered today. Balance includes stock movements through this date, including receipts, sales, damage, and corrections. Sales values use each bill&apos;s price.
          </p>
        </div>
        <button type="button" onClick={onRequestDownload} className="btn-outline min-h-10 !px-3 !py-2">
          <Download className="h-4 w-4" /> Download daily stock CSV
        </button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ReportCostCard label="Buyer sales" amount={buyerSalesTotal} />
        <ReportCostCard label="Retail sales" amount={retailSalesTotal} />
        <ReportCostCard label="Stock purchase cost" amount={offline || inventoryError ? null : receiptCost} />
      </div>

      {offline || inventoryError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Stock balance quantities are unavailable until the inventory database migration is applied and loaded.
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
          No tracked products yet. Start stock tracking to include balance quantities.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 font-bold">Product</th>
                <th className="px-4 py-3 font-bold">Morning count</th>
                <th className="px-4 py-3 text-right font-bold">Buyer sold</th>
                <th className="px-4 py-3 text-right font-bold">Retail sold</th>
                <th className="px-4 py-3 text-right font-bold">Damaged</th>
                <th className="px-4 py-3 text-right font-bold">Stock corrections</th>
                <th className="px-4 py-3 text-right font-bold">Balance (Mootai)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr key={row.productId}>
                  <td className="px-4 py-3 font-semibold text-ink-900">{row.productName}</td>
                  <td className={`px-4 py-3 ${row.countRecorded ? 'text-green-700' : 'text-amber-700'}`}>
                    {row.countRecorded ? `${formatQuantity(row.countedQuantity)} Mootai` : 'Count not recorded'}
                  </td>
                  <td className="px-4 py-3 text-right text-red-700">
                    <div>{formatQuantity(row.buyerSold)} Mootai</div>
                    <div className="mt-1 text-xs text-ink-500">{currencyINR(row.buyerRevenue)} sales</div>
                  </td>
                  <td className="px-4 py-3 text-right text-red-700">
                    <div>{formatQuantity(row.retailSold)} Mootai</div>
                    <div className="mt-1 text-xs text-ink-500">{currencyINR(row.retailRevenue)} sales</div>
                  </td>
                  <td className="px-4 py-3 text-right text-amber-800">{formatQuantity(row.damaged)}</td>
                  <td className="px-4 py-3 text-right">{formatQuantity(row.corrections)}</td>
                  <td className="px-4 py-3 text-right font-bold">{formatQuantity(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!offline && !inventoryError && rows.some((row) => !row.countRecorded) && (
        <p className="mt-3 text-xs text-amber-800">
          Products without a physical count are clearly marked and should be checked before relying on their balance.
        </p>
      )}
    </section>
  );
}

function ActivityEntry({ title, subtitle, amount, timestamp, emoji, note }) {
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
    </article>
  );
}

function WeekDatePicker({ value, onChange }) {
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
          const selected = day === value;
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

const TOP_BUYER_RANK_BADGES = [
  'bg-amber-500 text-white',
  'bg-slate-500 text-white',
  'bg-amber-700 text-white',
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
  const [selectedDate, setSelectedDate] = useState(realTodayIST);
  const [buyerFilter, setBuyerFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDownload, setConfirmDownload] = useState(null);
  const app = useAppData();
  const {
    buyerSales, retailSales, payments, buyers, products, balances,
    inventorySettings, inventoryCounts, inventoryMovements,
    inventoryLoading, inventoryError, loadInventory, offline,
    showToast,
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
  const dailyBuyerTotal = useMemo(() => sumSales(dailyBuyerSales), [dailyBuyerSales]);
  const dailyRetailTotal = useMemo(() => sumSales(dailyRetailSales), [dailyRetailSales]);
  const dailyPaymentsTotal = useMemo(
    () => dailyPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0),
    [dailyPayments]
  );
  const dailyBuyerSalesForStock = useMemo(
    () => (buyerSales || []).filter((sale) => String(sale.sale_date || '').slice(0, 10) === selectedDate),
    [buyerSales, selectedDate]
  );
  const dailyRetailSalesForStock = useMemo(
    () => (retailSales || []).filter((sale) => String(sale.sale_date || '').slice(0, 10) === selectedDate),
    [retailSales, selectedDate]
  );
  const dailyStockClosingRows = useMemo(
    () => buildDailyStockClosingRows(
      inventorySettings,
      inventoryMovements,
      inventoryCounts,
      products,
      selectedDate,
      dailyBuyerSalesForStock,
      dailyRetailSalesForStock,
    )
      .filter((row) => !productFilter || products.find((product) => product.id === row.productId)?.name === productFilter),
    [inventorySettings, inventoryMovements, inventoryCounts, products, selectedDate, dailyBuyerSalesForStock, dailyRetailSalesForStock, productFilter]
  );
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

  const downloadDailyStockCsv = () => {
    const rows = dailyStockClosingRows.map((row) => ({
      date: selectedDate,
      product: row.productName,
      morning_count_mootai: row.countedQuantity ?? '',
      morning_count_recorded: row.countRecorded,
      buyer_sales_mootai: row.buyerSold,
      buyer_sales_value: row.buyerRevenue,
      retail_sales_mootai: row.retailSold,
      retail_sales_value: row.retailRevenue,
      total_sales_mootai: row.sold,
      damaged_stock_mootai: row.damaged,
      stock_corrections_mootai: row.corrections,
      balance_stock_mootai: row.balance,
    }));
    downloadCsv(`daily-stock-${selectedDate}.csv`, rows);
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

  const topBuyers = useMemo(
    () => topBuyersForPeriod(filteredBuyerSales, balances),
    [filteredBuyerSales, balances]
  );

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

      <WeekDatePicker value={selectedDate} onChange={setSelectedDate} />

      <PeriodPills value={period} onChange={setPeriod} />

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
          Buyer filters apply to buyer sales and payments; product filters apply to sales, stock, and product reports. Choose a date above to see that day’s entries.
        </p>
      </section>

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
          >
            {dailyBuyerSales.map((sale) => {
              const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
              const rate = Number(sale.price_per_mootai ?? 0);
              const buyerName = buyersById.get(sale.buyer_id)?.name || 'Unknown buyer';
              return (
                <ActivityEntry
                  key={sale.id}
                  title={buyerName}
                  subtitle={`${sale.product || 'Product'} · ${quantity} Mootai × ${currencyINR(rate)}`}
                  amount={quantity * rate}
                  timestamp={entryTime(sale)}
                  emoji={getProductEmoji(sale.product, products)}
                  note={sale.notes}
                />
              );
            })}
          </DailyActivitySection>
          <DailyActivitySection
            title="Retail sales"
            count={dailyRetailSales.length}
            total={dailyRetailTotal}
            emptyText="No retail sales recorded on this date."
          >
            {dailyRetailSales.map((sale) => {
              const quantity = Number(sale.mootais_sold ?? sale.mootais ?? 0);
              const rate = Number(sale.price_per_mootai ?? 0);
              return (
                <ActivityEntry
                  key={sale.id}
                  title={sale.product || 'Retail sale'}
                  subtitle={`${quantity} Mootai × ${currencyINR(rate)}`}
                  amount={quantity * rate}
                  timestamp={entryTime(sale)}
                  emoji={getProductEmoji(sale.product, products)}
                  note={sale.notes}
                />
              );
            })}
          </DailyActivitySection>
          <DailyActivitySection
            title="Payments"
            count={dailyPayments.length}
            total={dailyPaymentsTotal}
            emptyText="No payments recorded on this date."
          >
            {dailyPayments.map((payment) => (
              <ActivityEntry
                key={payment.id}
                title={buyersById.get(payment.buyer_id)?.name || 'Unknown buyer'}
                subtitle="Buyer payment"
                amount={Number(payment.amount_paid || 0)}
                timestamp={entryTime(payment)}
                note={payment.notes}
              />
            ))}
          </DailyActivitySection>
        </div>
      </div>

      <DailyClosingSummary
        date={selectedDate}
        buyerSalesTotal={dailyBuyerTotal}
        retailSalesTotal={dailyRetailTotal}
        paymentsTotal={dailyPaymentsTotal}
        receiptCost={dailyReceiptCost}
        rows={dailyStockClosingRows}
        offline={offline}
        inventoryError={inventoryError}
        onRequestDownload={() => requestDownload(`the ${selectedDate} daily stock CSV`, downloadDailyStockCsv)}
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

      <section>
        <h2 className="mb-3 text-lg font-bold text-ink-900">Period totals · {periodLabel}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-brand-green/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-green-dark">TOTAL REVENUE</div>
            <div className="mt-2 text-4xl font-black text-brand-green-dark tracking-tight">
              {currencyINR(combined)}
            </div>
          </div>
          <div className="rounded-3xl border border-sidebar-accent/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-sidebar-accent">BUYER REVENUE</div>
            <div className="mt-2 text-4xl font-black text-sidebar-accent tracking-tight">
              {currencyINR(totalBuyer)}
            </div>
          </div>
          <div className="rounded-3xl border border-brand-purple/20 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-brand-purple">RETAIL REVENUE</div>
            <div className="mt-2 text-4xl font-black text-brand-purple tracking-tight">
              {currencyINR(totalRetail)}
            </div>
          </div>
          <ReportCostCard
            label="Gross profit (tracked sales)"
            amount={!offline && !inventoryLoading && !inventoryError && inventoryReport.trackedSalesCount
              ? inventoryReport.trackedGrossProfit
              : null}
          />
        </div>
        {inventoryReport.trackedSalesCount > 0 && inventoryReport.trackedRevenueCoverage < 100 && (
          <p className="mt-2 text-xs text-ink-500">
            Gross profit is sale revenue minus recorded stock cost. It covers {inventoryReport.trackedRevenueCoverage.toFixed(1)}% of revenue; sales without recorded stock cost are excluded.
          </p>
        )}
      </section>

      {!offline && (
        <section className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="font-bold text-ink-900 text-xl">Stock & cost report</h2>
              <p className="text-sm text-ink-500 mt-1">
                Cost and profit include only sales with recorded inventory costs.
              </p>
            </div>
            {inventoryReport.trackedSalesCount > 0 && (
              <span className="pill bg-sky-100 text-sky-800">
                {inventoryReport.trackedRevenueCoverage.toFixed(1)}% of sales revenue costed
              </span>
            )}
          </div>
          {inventoryLoading ? (
            <p className="text-sm text-ink-500">Loading inventory movements…</p>
          ) : inventoryError ? (
            <p className="text-sm text-amber-800">
              Inventory-aware reporting is unavailable until the v0.2 inventory migration is installed.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                <ReportCostCard label="Stock purchased" amount={inventoryReport.receiptCost} />
                <ReportCostCard label="Damaged stock cost" amount={inventoryReport.spoilageCost} />
                <ReportCostCard label="Tracked sales cost" amount={inventoryReport.trackedSaleCost} />
                <ReportCostCard
                  label="Gross profit on tracked sales"
                  amount={inventoryReport.trackedSalesCount ? inventoryReport.trackedGrossProfit : null}
                />
                <ReportCostCard
                  label="Profit after wastage"
                  amount={inventoryReport.trackedSalesCount ? inventoryReport.tradingProfit : null}
                />
              </div>
              {inventoryReport.trackedSalesCount > 0 && inventoryReport.trackedRevenueCoverage < 100 && (
                <p className="text-xs text-ink-500 mt-3">
                  Gross profit is partial because some sales have no recorded cost. Historical costs are not estimated.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
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
                    <div className="text-ink-600">{row.wholesale_quantity} Mootai · {currencyINR(row.wholesale_revenue)}</div>
                  </div>
                  <div className="rounded-xl bg-purple-50 px-3 py-2">
                    <div className="font-semibold text-purple-800">Retail</div>
                    <div className="text-ink-600">{row.retail_quantity} Mootai · {currencyINR(row.retail_revenue)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-500">
                  <span>Wastage cost: {currencyINR(row.spoilage_cost)}</span>
                  <span>Profit on tracked sales: {row.trading_profit == null ? 'Not tracked' : currencyINR(row.trading_profit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-ink-900 text-xl mb-5">Top Buyers</h3>

        {topBuyers.length === 0 && (
          <div className="text-center text-ink-500 text-sm py-10">No data for this period</div>
        )}

        {topBuyers.length > 0 && (
          <div className="max-h-[520px] divide-y divide-ink-100 overflow-y-auto">
            {topBuyers.slice(0, 3).map((buyer, index) => {
              const rankBadge = TOP_BUYER_RANK_BADGES[index] || 'bg-ink-100 text-ink-600';
              return (
                <div
                  key={buyer.buyer_id}
                  className="grid grid-cols-12 items-center gap-3 px-2 py-3 sm:px-3"
                >
                  <div className="col-span-1">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${rankBadge}`}>
                      {index + 1}
                    </span>
                  </div>
                  <div className="col-span-5 min-w-0">
                    <div className="truncate text-base font-bold text-ink-900">{buyer.name}</div>
                    <div className="mt-0.5 text-xs font-semibold text-ink-500">{buyer.total_mootais} Mootais</div>
                  </div>
                  <div className="col-span-3 text-sm font-extrabold tracking-tight text-ink-900 sm:text-lg">
                    {currencyINR(buyer.total_revenue)}
                  </div>
                  <div className="col-span-3 text-right text-xs font-bold text-amber-800 sm:text-sm">
                    <IndianRupee className="inline h-3.5 w-3.5 -mt-0.5" />
                    {currencyINR(buyer.pending).replace(/^₹/, '')} pending
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDownloadModal
        open={!!confirmDownload}
        fileLabel={confirmDownload?.fileLabel || ''}
        onClose={() => setConfirmDownload(null)}
        onConfirm={() => confirmDownload?.action()}
      />
    </div>
  );
}

function ReportCostCard({ label, amount }) {
  return (
    <div className="rounded-2xl bg-ink-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-2 text-xl font-extrabold text-ink-900">
        {amount == null ? '—' : currencyINR(amount)}
      </div>
    </div>
  );
}
