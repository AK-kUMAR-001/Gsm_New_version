import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import notoSansTamilRegularUrl from '../assets/fonts/NotoSansTamil-Regular.ttf?url';
import notoSansTamilBoldUrl from '../assets/fonts/NotoSansTamil-Bold.ttf?url';
import {
  formatDateCompact,
  formatQuantityByUnit,
  formatSaleQuantities,
  formatSaleRates,
  buyerSaleDiscountPercent,
  buyerSaleDiscountTotal,
  buyerSaleFinalTotal,
  buyerSaleOriginalTotal,
  dateRangeForPeriod,
  inPeriod,
  saleQuantitiesByUnit,
  saleQuantityUnit,
  realTodayIST,
  startOfMonthIST,
  startOfThreeMonthsAgo,
  startOfWeekIST,
} from './business.js';

const COLORS = {
  navy: [15, 52, 96],
  pale: [241, 246, 250],
  ink: [31, 41, 55],
  muted: [100, 116, 139],
};

const MONEY = (amount) => `INR ${Math.round(Number(amount || 0)).toLocaleString('en-IN')}`;
const MONEY_CENTS = (amount) => `INR ${Number(amount || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;
const billAmountDetails = (sale) => {
  const discount = buyerSaleDiscountTotal(sale);
  if (discount <= 0) return MONEY_CENTS(buyerSaleFinalTotal(sale));
  return [
    `Original: ${MONEY_CENTS(buyerSaleOriginalTotal(sale))}`,
    `Discount: ${MONEY_CENTS(discount)} (${buyerSaleDiscountPercent(sale).toFixed(2)}%)`,
    `Final: ${MONEY_CENTS(buyerSaleFinalTotal(sale))}`,
  ].join('\n');
};
const quantitiesByUnit = (sales) => (sales || []).reduce((quantities, sale) => {
  for (const [unit, quantity] of Object.entries(saleQuantitiesByUnit(sale))) {
    quantities[unit] = (quantities[unit] || 0) + quantity;
  }
  return quantities;
}, {});
const sumFinalBills = (sales) => (sales || []).reduce((sum, sale) => sum + buyerSaleFinalTotal(sale), 0);
const sumOriginalBills = (sales) => (sales || []).reduce((sum, sale) => sum + buyerSaleOriginalTotal(sale), 0);
const sumBillDiscounts = (sales) => (sales || []).reduce((sum, sale) => sum + buyerSaleDiscountTotal(sale), 0);
const PERIOD_NAMES = {
  week: 'This Week',
  month: 'This Month',
  '3months': 'Last 3 Months',
  all: 'All Time',
  today: 'Today',
};
const BILL_GREEN = [0, 130, 0];
const BILL_PRODUCT_NAMES_TA = {
  karuvepillai: 'கறிவேப்பிலை',
  keerai: 'கீரை',
  malli: 'மல்லி',
  pudina: 'புதினா',
};

function billProductName(product) {
  const name = String(product || '').trim();
  return BILL_PRODUCT_NAMES_TA[name.toLocaleLowerCase()] || name || 'Sale';
}

function formatBillMoney(amount) {
  return `₹ ${Math.round(Number(amount || 0)).toLocaleString('en-IN')}`;
}

function formatBillRate(amount) {
  return `₹ ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
}

function formatBillBalance(amount) {
  const value = Number(amount || 0);
  return value < 0 ? `- ${formatBillMoney(Math.abs(value))}` : formatBillMoney(value);
}

function billAmountInWords(amount) {
  const ones = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const underThousand = (value) => {
    const words = [];
    if (value >= 100) {
      words.push(`${ones[Math.floor(value / 100)]} Hundred`);
      value %= 100;
      if (value) words.push('and');
    }
    if (value >= 20) {
      words.push(tens[Math.floor(value / 10)]);
      value %= 10;
    }
    if (value) words.push(ones[value]);
    return words.join(' ');
  };
  let value = Math.max(0, Math.round(Number(amount || 0)));
  if (!value) return 'Zero Rupees only';
  const scales = ['', 'Thousand', 'Lakh', 'Crore', 'Arab', 'Kharab', 'Neel', 'Padma'];
  const chunks = [value % 1000];
  value = Math.floor(value / 1000);
  while (value > 0) {
    chunks.push(value % 100);
    value = Math.floor(value / 100);
  }
  const words = chunks
    .map((chunk, index) => (chunk ? `${underThousand(chunk)} ${scales[index] || ''}`.trim() : ''))
    .filter(Boolean)
    .reverse();
  return `${words.join(' ')} Rupees only`;
}

function formatBillDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function fontFileBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function registerTamilBillFonts(doc) {
  for (const [url, fileName, style] of [
    [notoSansTamilRegularUrl, 'NotoSansTamil-Regular.ttf', 'normal'],
    [notoSansTamilBoldUrl, 'NotoSansTamil-Bold.ttf', 'bold'],
  ]) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Tamil font files could not be loaded for the bill PDF.');
    doc.addFileToVFS(fileName, fontFileBase64(await response.arrayBuffer()));
    doc.addFont(fileName, 'NotoSansTamil', style);
  }
}

function periodLabel(period) {
  const today = realTodayIST();
  if (period === 'week') return `This Week (${formatDateCompact(startOfWeekIST('reports'))} - ${formatDateCompact(today)})`;
  if (period === 'month') return `This Month (${formatDateCompact(startOfMonthIST('reports'))} - ${formatDateCompact(today)})`;
  if (period === '3months') return `Last 3 Months (${formatDateCompact(startOfThreeMonthsAgo('reports'))} - ${formatDateCompact(today)})`;
  if (period === 'today') return `Today (${formatDateCompact(today)})`;
  return PERIOD_NAMES[period] || period;
}

function safeFilename(value, fallback = 'report') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w -]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || fallback;
}

function startDocument(title, period, orientation = 'landscape') {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  doc.setDisplayMode('fullwidth', 'continuous');
  drawDocumentHeader(doc, title, period);
  return doc;
}

function drawDocumentHeader(doc, title, period) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('GSM TRADERS', 14, 14);
  doc.setFontSize(12);
  doc.text(title, 14, 23);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${period}  |  Created ${formatDateCompact(realTodayIST())}`, 14, 30);
  doc.setTextColor(...COLORS.ink);
}

function addPageNumbers(doc) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 226, 232);
    doc.line(14, pageHeight - 13, pageWidth - 14, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text('GSM Traders  |  Business report', 14, pageHeight - 8);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
  }
}

function addMetricCards(doc, values, top = 40) {
  const gap = 4;
  const startX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const columns = pageWidth < 250 ? 2 : values.length;
  const width = (pageWidth - startX * 2 - gap * (columns - 1)) / columns;
  values.forEach((metric, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (width + gap);
    const y = top + row * 28;
    doc.setFillColor(...COLORS.pale);
    doc.roundedRect(x, y, width, 24, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(metric.label.toUpperCase(), x + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.ink);
    const valueLines = doc.splitTextToSize(String(metric.value), width - 8);
    doc.text(valueLines, x + 4, y + 12, { lineHeightFactor: 1.15 });
  });
  return top + Math.ceil(values.length / columns) * 28 - 4;
}

function pdfSaleQuantity(sale) {
  return formatSaleQuantities(sale).replace(/ \/ /g, '\n');
}

function pdfSaleRate(sale) {
  return formatSaleRates(sale)
    .replace(/₹/g, 'INR ')
    .replace(/ \/ /g, '\n');
}

const CUSTOMER_TRANSACTION_COLUMN_STYLES = {
  0: { cellWidth: 22, halign: 'left' },
  1: { cellWidth: 94, halign: 'left' },
  2: { cellWidth: 66, halign: 'left' },
};

const CUSTOMER_TRANSACTION_STYLES = {
  font: 'helvetica',
  fontSize: 9,
  cellPadding: 2,
  overflow: 'linebreak',
  textColor: COLORS.ink,
};

function buyerTransactionDetails(row) {
  const details = [row.details || ''];
  if (row.quantity && row.quantity !== '—') details.push(`Quantity: ${row.quantity}`);
  if (row.rate && row.rate !== '—') details.push(`Rate: ${row.rate}`);
  if (row.notes) details.push(`Notes: ${row.notes}`);
  return details.filter(Boolean).join('\n');
}

function buyerTransactionTableRows(rows) {
  return rows.map((row) => [
    formatDateCompact(row.date),
    buyerTransactionDetails(row),
    row.amount,
  ]);
}

function table(doc, options) {
  autoTable(doc, {
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.2, textColor: COLORS.ink },
    headStyles: { fillColor: COLORS.navy, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    margin: { left: 14, right: 14, bottom: 14 },
    ...options,
  });
}

export function downloadOverallReportPdf({
  period,
  totalWholesale,
  totalRetail,
  inventoryReport,
  productRows,
}) {
  const periodName = periodLabel(period);
  const doc = startDocument('Sales, Product & Stock Report', periodName, 'portrait');
  const totalRevenue = totalWholesale + totalRetail;
  const originalWholesale = productRows.reduce((sum, row) => sum + Number(row.wholesale_original_revenue || 0), 0);
  const wholesaleDiscount = productRows.reduce((sum, row) => sum + Number(row.wholesale_discount || 0), 0);
  const metricsEndY = addMetricCards(doc, [
    { label: 'Original buyer sales', value: MONEY(originalWholesale) },
    {
      label: 'Buyer discounts',
      value: `${MONEY(wholesaleDiscount)} (${originalWholesale > 0 ? ((wholesaleDiscount / originalWholesale) * 100).toFixed(2) : '0.00'}%)`,
    },
    { label: 'Final buyer sales', value: MONEY(totalWholesale) },
    { label: 'Retail sales', value: MONEY(totalRetail) },
    { label: 'Total final sales', value: MONEY(totalRevenue) },
    {
      label: 'Trading profit',
      value: inventoryReport.trackedSalesCount ? MONEY(inventoryReport.tradingProfit) : 'Not available',
    },
  ]);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.ink);
  const tableTop = metricsEndY + 10;
  doc.text('Product performance', 14, tableTop);
  table(doc, {
    startY: tableTop + 4,
    head: [['Product', 'Sales and stock details']],
    body: productRows.map((row) => [
      row.product,
      [
        `Buyer: ${formatQuantityByUnit(row.wholesale_quantities)} · ${MONEY(row.wholesale_revenue)}`,
        `Retail: ${formatQuantityByUnit(row.retail_quantities)} · ${MONEY(row.retail_revenue)}`,
        `Stock cost: ${row.tracked_sales ? MONEY(row.stock_cost) : 'Not tracked'}`,
        `Wastage: ${MONEY(row.spoilage_cost)}`,
        `Trading profit: ${row.trading_profit == null ? 'Not available' : MONEY(row.trading_profit)}`,
      ].join('\n'),
    ]),
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 148 },
    },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: COLORS.ink },
  });

  const noteY = (doc.lastAutoTable?.finalY || 74) + 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text('* Trading profit = tracked sales revenue - recorded stock cost - recorded spoilage cost.', 14, noteY);
  doc.text('Untracked sales are excluded from profit. Opening stock costs may be estimates. No rent, wages, fuel, or other expenses are included.', 14, noteY + 5, { maxWidth: 182 });
  doc.text(`Stock purchases in this period: ${MONEY(inventoryReport.receiptCost)}.`, 14, noteY + 12);

  addPageNumbers(doc);
  doc.save(`GSM_Overall_Report_${safeFilename(periodName)}.pdf`);
}

export function downloadCustomerStatementsPdf({
  period,
  buyers,
  buyerSales,
  payments,
  balances,
}) {
  const periodName = periodLabel(period);
  const doc = startDocument('Customer Bills & Payments', periodName, 'portrait');
  const balanceById = new Map((balances?.list || []).map((balance) => [balance.id, balance]));
  const salesInPeriod = (buyerSales || []).filter((sale) => inPeriod(sale.sale_date, period, 'reports'));
  const paymentsInPeriod = (payments || []).filter((payment) => inPeriod(payment.paid_at, period, 'reports'));
  const activity = new Set([
    ...salesInPeriod.map((sale) => sale.buyer_id),
    ...paymentsInPeriod.map((payment) => payment.buyer_id),
  ]);
  const statementBuyers = (buyers || [])
    .filter((buyer) => activity.has(buyer.id) || (balanceById.get(buyer.id)?.balance_due || 0) > 0)
    .sort((left, right) => left.name.localeCompare(right.name));

  const metricsEndY = addMetricCards(doc, [
    { label: 'Customers listed', value: String(statementBuyers.length) },
    { label: 'Original sales', value: MONEY(sumOriginalBills(salesInPeriod)) },
    { label: 'Discounts', value: MONEY(sumBillDiscounts(salesInPeriod)) },
    { label: 'Final sales', value: MONEY(sumFinalBills(salesInPeriod)) },
    {
      label: 'Payments in period',
      value: MONEY(paymentsInPeriod.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0)),
    },
    {
      label: 'Total pending',
      value: MONEY(statementBuyers.reduce((sum, buyer) => (
        sum + (balanceById.get(buyer.id)?.balance_due || 0)
      ), 0)),
    },
    {
      label: 'Balance corrections',
      value: MONEY(statementBuyers.reduce((sum, buyer) => (
        sum + Number(balanceById.get(buyer.id)?.balance_adjustment || 0)
      ), 0)),
    },
  ]);

  let cursorY = metricsEndY + 8;
  for (const buyer of statementBuyers) {
    const balance = balanceById.get(buyer.id);
    if (cursorY > doc.internal.pageSize.getHeight() - 65) {
      doc.addPage();
      drawDocumentHeader(doc, 'Customer Bills & Payments', periodName);
      cursorY = 42;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.navy);
    doc.text(buyer.name || 'Customer', 14, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `Phone: ${buyer.phone || 'Not recorded'}  |  Lifetime due: ${MONEY(balance?.balance_due)}  |  Credit: ${MONEY(balance?.credit_balance)}${Number(balance?.balance_adjustment || 0) !== 0 ? `  |  Balance correction: ${MONEY(balance.balance_adjustment)}` : ''}`,
      14,
      cursorY + 5
    );

    const transactions = [
      ...salesInPeriod
        .filter((sale) => sale.buyer_id === buyer.id)
        .map((sale) => ({
          date: sale.sale_date,
          kind: 'Bill',
          details: sale.product || 'Sale',
          quantity: pdfSaleQuantity(sale),
          rate: pdfSaleRate(sale),
          amount: billAmountDetails(sale),
          notes: sale.notes || '',
        })),
      ...paymentsInPeriod
        .filter((payment) => payment.buyer_id === buyer.id)
        .map((payment) => ({
          date: payment.paid_at,
          kind: 'Payment',
          details: 'Payment received',
          quantity: '—',
          rate: '—',
          amount: MONEY(payment.amount_paid),
          notes: payment.notes || '',
        })),
    ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

    table(doc, {
      startY: cursorY + 8,
      head: [['Date', 'Bill or payment details', 'Amount']],
      body: transactions.length
        ? buyerTransactionTableRows(transactions)
        : [['—', 'No bills or payments in this period', '—']],
      columnStyles: CUSTOMER_TRANSACTION_COLUMN_STYLES,
      styles: CUSTOMER_TRANSACTION_STYLES,
    });
    cursorY = (doc.lastAutoTable?.finalY || cursorY + 12) + 12;
  }

  addPageNumbers(doc);
  doc.save(`GSM_Customer_Statements_${safeFilename(periodName)}.pdf`);
}

export function downloadBuyerStatementPdf({ period, buyer, sales, payments, balance }) {
  const periodName = periodLabel(period);
  const doc = startDocument(`${buyer.name} - Statement`, periodName, 'portrait');
  const metricsEndY = addMetricCards(doc, [
    { label: 'Original bill', value: MONEY(sumOriginalBills(sales)) },
    { label: 'Discount', value: MONEY(sumBillDiscounts(sales)) },
    { label: 'Final bill', value: MONEY(sumFinalBills(sales)) },
    { label: 'Paid in period', value: MONEY(payments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0)) },
    { label: 'Lifetime due', value: MONEY(balance?.balance_due) },
    { label: 'Credit balance', value: MONEY(balance?.credit_balance) },
    ...(Number(balance?.balance_adjustment || 0) !== 0
      ? [{ label: 'Balance correction', value: MONEY(balance.balance_adjustment) }]
      : []),
  ]);

  const transactions = [
    ...sales.map((sale) => ({
      date: sale.sale_date,
      kind: 'Bill',
      details: sale.product || 'Sale',
      quantity: pdfSaleQuantity(sale),
      rate: pdfSaleRate(sale),
      amount: billAmountDetails(sale),
      notes: sale.notes || '',
    })),
    ...payments.map((payment) => ({
      date: payment.paid_at,
      kind: 'Payment',
      details: 'Payment received',
      quantity: '—',
      rate: '—',
      amount: MONEY(payment.amount_paid),
      notes: payment.notes || '',
    })),
  ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

  table(doc, {
    startY: metricsEndY + 18,
    head: [['Date', 'Bill or payment details', 'Amount']],
    body: transactions.length
      ? buyerTransactionTableRows(transactions)
      : [['—', 'No bills or payments in this period', '—']],
    columnStyles: CUSTOMER_TRANSACTION_COLUMN_STYLES,
    styles: CUSTOMER_TRANSACTION_STYLES,
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Customer: ${buyer.name}  |  Phone: ${buyer.phone || 'Not recorded'}`, 14, metricsEndY + 9);
  addPageNumbers(doc);
  doc.save(`GSM_${safeFilename(buyer.name)}_Statement_${safeFilename(periodName)}.pdf`);
}

export async function createBuyerBillFile({
  buyer,
  sales,
  payments,
  balance,
  balanceAdjustments = [],
  kind,
  selectedDate,
  anchorDate = realTodayIST(),
}) {
  const today = realTodayIST();
  let startDate = '';
  let endDate = today;
  let period = 'All Time';
  if (kind === 'full') {
    const recordDates = [
      ...sales.map((sale) => String(sale.sale_date || '').slice(0, 10)),
      ...payments.map((payment) => String(payment.paid_at || '').slice(0, 10)),
      ...balanceAdjustments.map((adjustment) => String(adjustment.created_at || '').slice(0, 10)),
    ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today).sort();
    period = recordDates.length
      ? `Complete bill (${formatDateCompact(recordDates[0])} - ${formatDateCompact(today)})`
      : `Complete bill (through ${formatDateCompact(today)})`;
  }
  if (kind === 'custom') {
    if (!selectedDate) throw new Error('Choose a bill date.');
    startDate = selectedDate;
    endDate = selectedDate;
    period = formatDateCompact(selectedDate);
  } else if (kind === 'week') {
    const range = dateRangeForPeriod('week', anchorDate);
    if (!range) throw new Error('Choose a valid date for the PDF period.');
    startDate = range.start;
    endDate = range.end;
    period = range.label;
  } else if (kind === 'monthly') {
    const range = dateRangeForPeriod('monthly', anchorDate);
    if (!range) throw new Error('Choose a valid date for the PDF period.');
    startDate = range.start;
    endDate = range.end;
    period = range.label;
  } else if (kind === '3months') {
    const range = dateRangeForPeriod('3months', anchorDate);
    if (!range) throw new Error('Choose a valid date for the PDF period.');
    startDate = range.start;
    endDate = range.end;
    period = range.label;
  } else if (kind !== 'full') {
    throw new Error('Choose a valid bill period.');
  }
  const inSelectedPeriod = (value) => {
    const date = String(value || '').slice(0, 10);
    return date && date <= endDate && (!startDate || date >= startDate);
  };
  const billSales = sales.filter((sale) => inSelectedPeriod(sale.sale_date));
  const billPayments = payments.filter((payment) => inSelectedPeriod(payment.paid_at));
  const billed = sumFinalBills(billSales);
  const originalBilled = sumOriginalBills(billSales);
  const paid = billPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const groupedSales = new Map();
  const quantities = {};
  for (const sale of billSales) {
    const date = String(sale.sale_date || '').slice(0, 10);
    const unit = saleQuantityUnit(sale);
    const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
    const rate = Number(sale.price_per_mootai || 0);
    const product = sale.product || 'Sale';
    const key = `${date}\u0000${product}\u0000${unit}\u0000${rate.toFixed(6)}`;
    const row = groupedSales.get(key) || {
      date,
      product,
      unit,
      quantity: 0,
      rate,
      amount: 0,
    };
    row.quantity += quantity;
    row.amount += buyerSaleFinalTotal(sale);
    groupedSales.set(key, row);
    quantities[unit] = (quantities[unit] || 0) + quantity;
  }
  const billRows = [...groupedSales.values()]
    .sort((first, second) => first.date.localeCompare(second.date));
  const totalQuantityLines = Object.entries(quantities)
    .map(([unit, quantity]) => `${quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}\n${unit}`)
    .join('\n');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [420, 595] });
  await registerTamilBillFonts(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 24;
  const sectionWidth = pageWidth - margin * 2;
  const periodDate = startDate && startDate === endDate
    ? formatBillDate(startDate)
    : period;
  const createdTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).replace(/\b(am|pm)\b/i, (meridiem) => meridiem.toUpperCase());

  doc.setFillColor(...BILL_GREEN);
  doc.rect(margin, 24, sectionWidth, 36, 'F');
  doc.setFont('NotoSansTamil', 'bold');
  let billTitle = `${buyer.name || 'Customer'} VEGETABLES`;
  let billTitleSize = 23;
  doc.setFontSize(billTitleSize);
  while (doc.getTextWidth(billTitle) > sectionWidth - 16 && billTitleSize > 12) {
    billTitleSize -= 1;
    doc.setFontSize(billTitleSize);
  }
  const billTitleLines = doc.splitTextToSize(billTitle, sectionWidth - 16);
  doc.setTextColor(255, 255, 255);
  doc.text(billTitleLines, pageWidth / 2, billTitleLines.length > 1 ? 40 : 49, { align: 'center' });
  doc.setFontSize(17);
  doc.setTextColor(...BILL_GREEN);
  doc.text('Bill', pageWidth / 2, 82, { align: 'center' });

  doc.setFillColor(...BILL_GREEN);
  doc.rect(margin, 102, sectionWidth, 22, 'F');
  doc.setFont('NotoSansTamil', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('Bill From', margin + 5, 118);
  doc.text('Bill Details', 248, 118);

  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(13);
  doc.text('MIDHUN SAKTHI', margin + 4, 146);
  doc.setFont('NotoSansTamil', 'normal');
  doc.setFontSize(12);
  doc.text('UKKADAM', margin + 4, 165);
  doc.text('Contact No.: +91 63740 97754', margin + 4, 184);
  doc.setFontSize(12);
  const billDateLines = doc.splitTextToSize(`Date: ${periodDate}`, 166);
  doc.text(billDateLines, 250, 146);
  doc.text(`Time: ${createdTime}`, 250, 146 + billDateLines.length * 16);

  doc.setFillColor(...BILL_GREEN);
  doc.rect(margin, 198, sectionWidth, 22, 'F');
  doc.setFont('NotoSansTamil', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('Bill To', margin + 5, 214);
  doc.setFont('NotoSansTamil', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.ink);
  const buyerDetails = [buyer.name || 'Customer', buyer.phone ? `Phone: ${buyer.phone}` : '']
    .filter(Boolean)
    .join('  |  ');
  const buyerDetailsLines = doc.splitTextToSize(buyerDetails, sectionWidth - 8);
  doc.text(buyerDetailsLines, margin + 4, 239);

  table(doc, {
    startY: 252 + Math.max(0, buyerDetailsLines.length - 1) * 14,
    head: [['Date', '#', 'Item name', 'Quantity', 'Price/unit', 'Amount']],
    body: billRows.length
      ? billRows.map((row, index) => [
        formatBillDate(row.date) || '—',
        String(index + 1),
        billProductName(row.product),
        `${row.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}\n${row.unit}`,
        `${formatBillRate(row.rate)}\n/${row.unit}`,
        formatBillMoney(row.amount),
      ])
      : [['', '', 'No sales recorded for this period', '', '', formatBillMoney(0)]],
    foot: [['', '', 'Total', totalQuantityLines, '', formatBillMoney(billed)]],
    showFoot: 'lastPage',
    margin: { left: margin, right: margin, top: 24, bottom: 24 },
    columnStyles: {
      0: { cellWidth: 58, halign: 'left', cellPadding: 3, fontSize: 8 },
      1: { cellWidth: 20, halign: 'left', cellPadding: 3, fontSize: 9 },
      2: { cellWidth: 82, halign: 'left' },
      3: { cellWidth: 62, halign: 'right' },
      4: { cellWidth: 70, halign: 'right' },
      5: { cellWidth: 80, halign: 'right', fontSize: 9 },
    },
    styles: {
      font: 'NotoSansTamil',
      fontSize: 11,
      cellPadding: 7,
      textColor: COLORS.ink,
      lineColor: [150, 150, 150],
      lineWidth: 0.5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: BILL_GREEN,
      textColor: 255,
      font: 'NotoSansTamil',
      fontStyle: 'bold',
      fontSize: 12,
    },
    footStyles: {
      fillColor: [245, 249, 245],
      textColor: COLORS.ink,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    didParseCell: (cellData) => {
      if (cellData.section !== 'head' && cellData.column.index === 3) {
        cellData.cell.styles.fontSize = 9;
      }
    },
  });

  doc.addPage([420, 595], 'portrait');
  const summaryLeftWidth = 200;
  const summaryRightX = 232;
  const summaryRightWidth = pageWidth - margin - summaryRightX;
  const drawSectionTitle = (x, y, width, title) => {
    doc.setFillColor(...BILL_GREEN);
    doc.rect(x, y, width, 22, 'F');
    doc.setFont('NotoSansTamil', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(title, x + 5, y + 15);
  };
  drawSectionTitle(margin, 24, summaryLeftWidth, 'Bill Amount In Words');
  drawSectionTitle(summaryRightX, 24, summaryRightWidth, 'Amounts');

  doc.setFont('NotoSansTamil', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.ink);
  doc.text(doc.splitTextToSize(billAmountInWords(billed), summaryLeftWidth - 8), margin + 4, 61);
  drawSectionTitle(margin, 130, summaryLeftWidth, 'Terms and conditions');
  doc.setFontSize(13);
  doc.text(
    doc.splitTextToSize('Thank you for doing business with us.', summaryLeftWidth - 8),
    margin + 4,
    167,
  );

  const currentNetBalance = Number(balance?.balance_due || 0) - Number(balance?.credit_balance || 0);
  const adjustmentDate = (adjustment) => String(adjustment.created_at || '').slice(0, 10);
  const salesAfterPeriod = sales
    .filter((sale) => String(sale.sale_date || '').slice(0, 10) > endDate)
    .reduce((sum, sale) => sum + buyerSaleFinalTotal(sale), 0);
  const paymentsAfterPeriod = payments
    .filter((payment) => String(payment.paid_at || '').slice(0, 10) > endDate)
    .reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const adjustmentsAfterPeriod = balanceAdjustments
    .filter((adjustment) => adjustmentDate(adjustment) > endDate)
    .reduce((sum, adjustment) => sum + Number(adjustment.adjustment_amount || 0), 0);
  const adjustmentsInPeriod = balanceAdjustments
    .filter((adjustment) => adjustmentDate(adjustment) <= endDate
      && (!startDate || adjustmentDate(adjustment) >= startDate))
    .reduce((sum, adjustment) => sum + Number(adjustment.adjustment_amount || 0), 0);
  const periodEndBalance = currentNetBalance - salesAfterPeriod + paymentsAfterPeriod - adjustmentsAfterPeriod;
  const previousBalance = periodEndBalance - billed + paid - adjustmentsInPeriod;
  const totals = [
    { label: 'Sub Total', value: formatBillMoney(originalBilled) },
    ...(originalBilled !== billed
      ? [{ label: 'Discount', value: formatBillMoney(originalBilled - billed) }]
      : []),
    { label: 'Total', value: formatBillMoney(billed), bold: true },
    { label: 'Paid', value: formatBillMoney(paid) },
    { label: 'Balance', value: formatBillBalance(billed - paid) },
    { label: 'Previous Balance', value: formatBillBalance(previousBalance) },
    { label: 'Current Balance', value: formatBillBalance(periodEndBalance), bold: true },
  ];
  let totalsY = 62;
  for (const row of totals) {
    doc.setFont('NotoSansTamil', row.bold ? 'bold' : 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.ink);
    const labelLines = doc.splitTextToSize(row.label, 72);
    let valueFontSize = 11;
    while (doc.getTextWidth(row.value) > 78 && valueFontSize > 8) {
      valueFontSize -= 1;
      doc.setFontSize(valueFontSize);
    }
    const valueLines = doc.splitTextToSize(row.value, 78);
    const rowHeight = Math.max(labelLines.length * 13, valueLines.length * (valueFontSize + 2)) + 8;
    doc.setFontSize(11);
    doc.text(labelLines, summaryRightX + 5, totalsY + 12);
    doc.setFontSize(valueFontSize);
    doc.text(valueLines, pageWidth - margin - 5, totalsY + 12, { align: 'right' });
    doc.setDrawColor(190, 190, 190);
    doc.line(summaryRightX, totalsY + rowHeight - 2, pageWidth - margin, totalsY + rowHeight - 2);
    totalsY += rowHeight;
  }

  const filename = `${safeFilename(buyer.name, 'Customer')}_VEGETABLES_Bill_${safeFilename(period)}.pdf`;
  return new File([doc.output('blob')], filename, { type: 'application/pdf' });
}
