import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import gsmLogoUrl from '../assets/Gsm_logo.png';
import {
  formatDateCompact,
  formatQuantityByUnit,
  formatSaleQuantities,
  formatSaleRates,
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
const RATE = (amount) => `INR ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 6 })}`;
const quantitiesByUnit = (sales) => (sales || []).reduce((quantities, sale) => {
  for (const [unit, quantity] of Object.entries(saleQuantitiesByUnit(sale))) {
    quantities[unit] = (quantities[unit] || 0) + quantity;
  }
  return quantities;
}, {});
const billQuantitiesByUnit = (sales) => (sales || []).reduce((quantities, sale) => {
  const unit = saleQuantityUnit(sale);
  quantities[unit] = (quantities[unit] || 0) + Number(sale.mootais ?? sale.mootais_sold ?? 0);
  return quantities;
}, {});
const billSaleQuantity = (sale) => (
  `${Number(sale.mootais ?? sale.mootais_sold ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${saleQuantityUnit(sale)}`
);
const billSaleRate = (sale) => `${RATE(sale.price_per_mootai)}/${saleQuantityUnit(sale)}`;
const PERIOD_NAMES = {
  week: 'This Week',
  month: 'This Month',
  '3months': 'Last 3 Months',
  all: 'All Time',
  today: 'Today',
};

function periodLabel(period) {
  const today = realTodayIST();
  if (period === 'week') return `This Week (${formatDateCompact(startOfWeekIST('reports'))} - ${formatDateCompact(today)})`;
  if (period === 'month') return `This Month (${formatDateCompact(startOfMonthIST('reports'))} - ${formatDateCompact(today)})`;
  if (period === '3months') return `Last 3 Months (${formatDateCompact(startOfThreeMonthsAgo('reports'))} - ${formatDateCompact(today)})`;
  if (period === 'today') return `Today (${formatDateCompact(today)})`;
  return PERIOD_NAMES[period] || period;
}

function safeFilename(value) {
  return String(value || 'report')
    .normalize('NFKD')
    .replace(/[^\w -]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'report';
}

function startDocument(title, period) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFillColor(...COLORS.navy);
  doc.rect(0, 0, 297, 34, 'F');
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
  return doc;
}

function addPageNumbers(doc) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 226, 232);
    doc.line(14, 197, 283, 197);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text('GSM Traders  |  Business report', 14, 202);
    doc.text(`Page ${page} of ${pageCount}`, 283, 202, { align: 'right' });
  }
}

function addMetricCards(doc, values, top = 40) {
  const gap = 4;
  const startX = 14;
  const width = (269 - gap * (values.length - 1)) / values.length;
  values.forEach((metric, index) => {
    const x = startX + index * (width + gap);
    doc.setFillColor(...COLORS.pale);
    doc.roundedRect(x, top, width, 24, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(metric.label.toUpperCase(), x + 4, top + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.ink);
    const valueLines = doc.splitTextToSize(String(metric.value), width - 8);
    doc.text(valueLines, x + 4, top + 12, { lineHeightFactor: 1.15 });
  });
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
  0: { cellWidth: 23, halign: 'left' },
  1: { cellWidth: 16, halign: 'left' },
  2: { cellWidth: 39, halign: 'left' },
  3: { cellWidth: 35, halign: 'left' },
  4: { cellWidth: 46, halign: 'left' },
  5: { cellWidth: 31, halign: 'right' },
  6: { halign: 'left' },
};

const CUSTOMER_TRANSACTION_STYLES = {
  font: 'helvetica',
  fontSize: 7.5,
  cellPadding: 1.5,
  overflow: 'linebreak',
  textColor: COLORS.ink,
};

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
  const doc = startDocument('Sales, Product & Stock Report', periodName);
  const totalRevenue = totalWholesale + totalRetail;
  addMetricCards(doc, [
    { label: 'Total sales', value: MONEY(totalRevenue) },
    { label: 'Wholesale sales', value: MONEY(totalWholesale) },
    { label: 'Retail sales', value: MONEY(totalRetail) },
    {
      label: 'Trading profit',
      value: inventoryReport.trackedSalesCount ? MONEY(inventoryReport.tradingProfit) : 'Not available',
    },
  ]);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.ink);
  doc.text('Product performance', 14, 70);
  table(doc, {
    startY: 74,
    head: [[
      'Product',
      'Wholesale qty',
      'Wholesale sales',
      'Retail qty',
      'Retail sales',
      'Stock cost',
      'Wastage cost',
      'Trading profit*',
    ]],
    body: productRows.map((row) => [
      row.product,
      formatQuantityByUnit(row.wholesale_quantities),
      MONEY(row.wholesale_revenue),
      formatQuantityByUnit(row.retail_quantities),
      MONEY(row.retail_revenue),
      row.tracked_sales ? MONEY(row.stock_cost) : 'Not tracked',
      MONEY(row.spoilage_cost),
      row.trading_profit == null ? 'Not available' : MONEY(row.trading_profit),
    ]),
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 32 },
      2: { cellWidth: 36 },
      3: { cellWidth: 27 },
      4: { cellWidth: 33 },
      5: { cellWidth: 34 },
      6: { cellWidth: 32 },
      7: { cellWidth: 39 },
    },
  });

  const noteY = (doc.lastAutoTable?.finalY || 74) + 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text('* Trading profit = tracked sales revenue - recorded stock cost - recorded spoilage cost.', 14, noteY);
  doc.text('Untracked sales are excluded from profit. Opening stock costs may be estimates. No rent, wages, fuel, or other expenses are included.', 14, noteY + 5);
  doc.text(`Stock purchases in this period: ${MONEY(inventoryReport.receiptCost)}.`, 14, noteY + 10);

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
  const doc = startDocument('Customer Bills & Payments', periodName);
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

  addMetricCards(doc, [
    { label: 'Customers listed', value: String(statementBuyers.length) },
    {
      label: 'Sales in period',
      value: MONEY(salesInPeriod.reduce((sum, sale) => (
        sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
      ), 0)),
    },
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
  ]);

  let cursorY = 68;
  for (const buyer of statementBuyers) {
    const balance = balanceById.get(buyer.id);
    if (cursorY > 177) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.navy);
    doc.text(buyer.name || 'Customer', 14, cursorY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `Phone: ${buyer.phone || 'Not recorded'}  |  Lifetime due: ${MONEY(balance?.balance_due)}  |  Credit: ${MONEY(balance?.credit_balance)}`,
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
          amount: MONEY(Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)),
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
      head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate', 'Amount', 'Notes']],
      body: transactions.length
        ? transactions.map((row) => [
          formatDateCompact(row.date), row.kind, row.details, row.quantity, row.rate, row.amount, row.notes,
        ])
        : [['—', '—', 'No bills or payments in this period', '—', '—', '—', '']],
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
  const doc = startDocument(`${buyer.name} - Statement`, periodName);
  addMetricCards(doc, [
    { label: 'Billed in period', value: MONEY(sales.reduce((sum, sale) => (
      sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
    ), 0)) },
    { label: 'Paid in period', value: MONEY(payments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0)) },
    { label: 'Lifetime due', value: MONEY(balance?.balance_due) },
    { label: 'Credit balance', value: MONEY(balance?.credit_balance) },
  ]);

  const transactions = [
    ...sales.map((sale) => ({
      date: sale.sale_date,
      kind: 'Bill',
      details: sale.product || 'Sale',
      quantity: pdfSaleQuantity(sale),
      rate: pdfSaleRate(sale),
      amount: MONEY(Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)),
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
    startY: 68,
    head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate', 'Amount', 'Notes']],
    body: transactions.length
      ? transactions.map((row) => [
        formatDateCompact(row.date), row.kind, row.details, row.quantity, row.rate, row.amount, row.notes,
      ])
      : [['—', '—', 'No bills or payments in this period', '—', '—', '—', '']],
    columnStyles: CUSTOMER_TRANSACTION_COLUMN_STYLES,
    styles: CUSTOMER_TRANSACTION_STYLES,
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Customer: ${buyer.name}  |  Phone: ${buyer.phone || 'Not recorded'}`, 14, 64);
  addPageNumbers(doc);
  doc.save(`GSM_${safeFilename(buyer.name)}_Statement_${safeFilename(periodName)}.pdf`);
}

export async function createBuyerBillFile({ buyer, sales, payments, balance, kind, selectedDate }) {
  const today = realTodayIST();
  const monthKey = today.slice(0, 7);
  let startDate = '';
  let endDate = today;
  let period = 'All Time';
  if (kind === 'custom') {
    if (!selectedDate) throw new Error('Choose a bill date.');
    startDate = selectedDate;
    endDate = selectedDate;
    period = formatDateCompact(selectedDate);
  } else if (kind === 'week') {
    startDate = startOfWeekIST('reports');
    period = `This Week (${formatDateCompact(startDate)} - ${formatDateCompact(endDate)})`;
  } else if (kind === 'monthly') {
    startDate = `${monthKey}-01`;
    period = `This Month (${formatDateCompact(startDate)} - ${formatDateCompact(endDate)})`;
  } else if (kind !== 'full') {
    throw new Error('Choose a valid bill period.');
  }
  const inSelectedPeriod = (value) => {
    const date = String(value || '').slice(0, 10);
    return date && date <= endDate && (!startDate || date >= startDate);
  };
  const billSales = sales.filter((sale) => inSelectedPeriod(sale.sale_date));
  const billPayments = payments.filter((payment) => inSelectedPeriod(payment.paid_at));
  const billed = billSales.reduce((sum, sale) => (
    sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
  ), 0);
  const paid = billPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const title = kind === 'full'
    ? 'Complete Detailed Bill'
    : kind === 'monthly'
      ? 'Monthly Bill Summary'
      : 'Bill Statement';
  const doc = startDocument(title, period);
  const logoResponse = await fetch(gsmLogoUrl);
  if (!logoResponse.ok) throw new Error('The GSM logo could not be loaded for the PDF.');
  const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());
  doc.addImage(logoBytes, 'PNG', 258, 3, 25, 25);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.ink);
  doc.text(`Customer: ${buyer.name}  |  Phone: ${buyer.phone || 'Not recorded'}`, 14, 39);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Hi ${buyer.name}, please find your GSM Traders bill for ${period} below.`, 14, 45);

  addMetricCards(doc, [
    { label: 'Total quantity', value: formatQuantityByUnit(billQuantitiesByUnit(billSales)) || '0' },
    { label: kind === 'full' ? 'Total billed' : 'Billed in period', value: MONEY(billed) },
    { label: kind === 'full' ? 'Total paid' : 'Paid in period', value: MONEY(paid) },
    { label: 'Amount pending', value: MONEY(balance?.balance_due) },
  ], 52);

  if (kind === 'monthly') {
    const byProduct = new Map();
    for (const sale of billSales) {
      const key = sale.product || 'Sale';
      const row = byProduct.get(key) || { quantities: {}, revenueByUnit: {}, billed: 0 };
      const saleQuantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
      const saleRevenue = saleQuantity * Number(sale.price_per_mootai || 0);
      const unit = saleQuantityUnit(sale);
      row.quantities[unit] = (row.quantities[unit] || 0) + saleQuantity;
      row.revenueByUnit[unit] = (row.revenueByUnit[unit] || 0) + saleRevenue;
      row.billed += saleRevenue;
      byProduct.set(key, row);
    }
    table(doc, {
      startY: 80,
      head: [['Product', 'Quantity by unit', 'Average rate by unit', 'Total Bill']],
      body: byProduct.size
        ? Array.from(byProduct.entries()).map(([product, row]) => [
          product,
          formatQuantityByUnit(row.quantities),
          Object.entries(row.quantities)
            .map(([unit, quantity]) => `${RATE(quantity ? row.revenueByUnit[unit] / quantity : 0)}/${unit}`)
            .join(' · '),
          MONEY(row.billed),
        ])
        : [['—', '—', '—', 'No sales recorded for this period']],
      columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 52 }, 2: { cellWidth: 52 } },
    });
    const paymentY = (doc.lastAutoTable?.finalY || 88) + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.ink);
    doc.text(`Payments received this period: ${MONEY(paid)}`, 14, paymentY);
  } else {
    const transactions = [
      ...billSales.map((sale) => ({
        date: sale.sale_date,
        kind: 'Bill',
        product: sale.product || 'Sale',
        quantity: billSaleQuantity(sale),
        rate: billSaleRate(sale),
        amount: MONEY(Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)),
        notes: sale.notes || '',
      })),
      ...billPayments.map((paymentRow) => ({
        date: paymentRow.paid_at,
        kind: 'Payment',
        product: 'Payment received',
        quantity: '—',
        rate: '—',
        amount: MONEY(paymentRow.amount_paid),
        notes: paymentRow.notes || '',
      })),
    ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
    table(doc, {
      startY: 80,
      head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate', 'Amount', 'Notes']],
      body: transactions.length
        ? transactions.map((row) => [
          formatDateCompact(row.date), row.kind, row.product, row.quantity, row.rate, row.amount, row.notes,
        ])
        : [['—', '—', 'No bills or payments recorded', '—', '—', '—', '']],
      columnStyles: CUSTOMER_TRANSACTION_COLUMN_STYLES,
      styles: CUSTOMER_TRANSACTION_STYLES,
    });
  }

  addPageNumbers(doc);
  const filename = `GSM_${safeFilename(buyer.name)}_${kind === 'full' ? 'Complete_Bill' : 'Bill'}_${safeFilename(period)}.pdf`;
  return new File([doc.output('blob')], filename, { type: 'application/pdf' });
}
