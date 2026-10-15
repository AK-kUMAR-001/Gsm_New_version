import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatDateCompact,
  formatSaleQuantities,
  formatUnitQuantities,
  inPeriod,
  realTodayIST,
  saleQuantitiesForDisplay,
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
const QUANTITY = (amount) => Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
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
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'report';
}

function pdfSaleRate(sale) {
  const amount = Number(sale?.mootais ?? sale?.mootais_sold ?? 0)
    * Number(sale?.price_per_mootai ?? 0);
  return Object.entries(saleQuantitiesForDisplay(sale))
    .map(([unit, quantity]) => {
      const rate = quantity === 0 ? 0 : amount / quantity;
      return `${rate.toLocaleString('en-IN', { maximumFractionDigits: 6 })} / ${unit}`;
    })
    .join('  |  ') || '-';
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
    doc.roundedRect(x, top, width, 20, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(metric.label.toUpperCase(), x + 4, top + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.ink);
    doc.text(metric.value, x + 4, top + 15);
  });
}

function table(doc, options) {
  autoTable(doc, {
    theme: 'striped',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.2,
      overflow: 'linebreak',
      textColor: COLORS.ink,
      valign: 'middle',
    },
    headStyles: { fillColor: COLORS.navy, textColor: 255, fontStyle: 'bold', overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    margin: { left: 14, right: 14, bottom: 14 },
    rowPageBreak: 'avoid',
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
      formatUnitQuantities(row.wholesale_quantities_by_unit),
      MONEY(row.wholesale_revenue),
      formatUnitQuantities(row.retail_quantities_by_unit),
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
    if (cursorY > 158) {
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
          quantity: formatSaleQuantities(sale),
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
          quantity: '-',
          rate: '-',
          amount: MONEY(payment.amount_paid),
          notes: payment.notes || '',
        })),
    ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

    table(doc, {
      startY: cursorY + 8,
      showHead: 'everyPage',
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      margin: { left: 12, right: 12, top: 28, bottom: 14 },
      willDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFillColor(...COLORS.pale);
          doc.rect(12, 10, 273, 12, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(...COLORS.navy);
          doc.text(`${buyer.name || 'Customer'} - continued`, 16, 18);
        }
      },
      head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate (INR)', 'Amount (INR)', 'Notes']],
      body: transactions.length
        ? transactions.map((row) => [
          formatDateCompact(row.date), row.kind, row.details, row.quantity, row.rate, row.amount, row.notes,
        ])
        : [['-', '-', 'No bills or payments in this period', '-', '-', '-', '']],
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 43 },
        3: { cellWidth: 34, halign: 'right' },
        4: { cellWidth: 60, halign: 'right' },
        5: { cellWidth: 33, halign: 'right' },
        6: { cellWidth: 60 },
      },
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
      quantity: formatSaleQuantities(sale),
      rate: pdfSaleRate(sale),
      amount: MONEY(Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)),
      notes: sale.notes || '',
    })),
    ...payments.map((payment) => ({
      date: payment.paid_at,
      kind: 'Payment',
      details: 'Payment received',
      quantity: '-',
      rate: '-',
      amount: MONEY(payment.amount_paid),
      notes: payment.notes || '',
    })),
  ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  const customerDetails = doc.splitTextToSize(
    `Customer: ${buyer.name}  |  Phone: ${buyer.phone || 'Not recorded'}`,
    269,
  );
  doc.text(
    customerDetails,
    14,
    64,
  );
  const tableStartY = 64 + customerDetails.length * 4 + 4;
  table(doc, {
    startY: tableStartY,
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate (INR)', 'Amount (INR)', 'Notes']],
    body: transactions.length
      ? transactions.map((row) => [
        formatDateCompact(row.date), row.kind, row.details, row.quantity, row.rate, row.amount, row.notes,
      ])
      : [['-', '-', 'No bills or payments in this period', '-', '-', '-', '']],
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 43 },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 60, halign: 'right' },
      5: { cellWidth: 33, halign: 'right' },
      6: { cellWidth: 56 },
    },
  });
  addPageNumbers(doc);
  doc.save(`${safeFilename(buyer.name)}_GSM_${realTodayIST()}.pdf`);
}

export function createBuyerBillFile({ buyer, sales, payments, balance, kind }) {
  const monthKey = realTodayIST().slice(0, 7);
  const billSales = kind === 'monthly'
    ? sales.filter((sale) => String(sale.sale_date || '').slice(0, 7) === monthKey)
    : sales;
  const billPayments = kind === 'monthly'
    ? payments.filter((payment) => String(payment.paid_at || '').slice(0, 7) === monthKey)
    : payments;
  const quantities = billSales.reduce((totals, sale) => {
    for (const [unit, quantity] of Object.entries(saleQuantitiesForDisplay(sale))) {
      totals[unit] = (totals[unit] || 0) + quantity;
    }
    return totals;
  }, {});
  const billed = billSales.reduce((sum, sale) => (
    sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
  ), 0);
  const paid = billPayments.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const title = kind === 'monthly' ? 'Monthly Bill Summary' : 'Complete Detailed Bill';
  const period = kind === 'monthly'
    ? new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'All Time';
  const doc = startDocument(title, period);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.ink);
  const customerDetails = doc.splitTextToSize(
    `Customer: ${buyer.name}  |  Phone: ${buyer.phone || 'Not recorded'}`,
    269,
  );
  doc.text(customerDetails, 14, 39);
  const introY = 39 + customerDetails.length * 5 + 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text(
    doc.splitTextToSize(
      `Hi ${buyer.name}, please find your GSM Traders ${kind === 'monthly' ? 'monthly' : 'complete'} bill below.`,
      269,
    ),
    14,
    introY,
  );
  const metricTop = introY + 7;

  addMetricCards(doc, [
    { label: 'Total quantities', value: formatUnitQuantities(quantities) },
    { label: kind === 'monthly' ? 'Billed this month' : 'Total billed', value: MONEY(billed) },
    { label: kind === 'monthly' ? 'Paid this month' : 'Total paid', value: MONEY(paid) },
    { label: 'Amount pending', value: MONEY(balance?.balance_due) },
  ], metricTop);
  const tableStartY = metricTop + 28;

  if (kind === 'monthly') {
    const byProduct = new Map();
    for (const sale of billSales) {
      const key = sale.product || 'Sale';
      const row = byProduct.get(key) || { product: key, quantities: {}, rates: {}, billed: 0 };
      const saleQuantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
      const amount = saleQuantity * Number(sale.price_per_mootai || 0);
      for (const [unit, quantity] of Object.entries(saleQuantitiesForDisplay(sale))) {
        row.quantities[unit] = (row.quantities[unit] || 0) + quantity;
        row.rates[unit] = (row.rates[unit] || 0) + amount;
      }
      row.billed += amount;
      byProduct.set(key, row);
    }
    table(doc, {
      startY: tableStartY,
      head: [['Product', 'Quantity', 'Rate (INR) / Unit', 'Total Bill']],
      body: byProduct.size
        ? Array.from(byProduct.values()).map((row) => [
          row.product,
          formatUnitQuantities(row.quantities),
          Object.entries(row.quantities).map(([unit, quantity]) => (
            `${Number(quantity ? row.rates[unit] / quantity : 0).toLocaleString('en-IN', { maximumFractionDigits: 6 })} / ${unit}`
          )).join(' / '),
          MONEY(row.billed),
        ])
            : [['No sales recorded this month', '-', '-', '-']],
    });
    const paymentY = (doc.lastAutoTable?.finalY || 88) + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.ink);
    doc.text(`Payments received this month: ${MONEY(paid)}`, 14, paymentY);
  } else {
    const transactions = [
      ...billSales.map((sale) => ({
        date: sale.sale_date,
        kind: 'Bill',
        product: sale.product || 'Sale',
        quantity: formatSaleQuantities(sale),
        rate: pdfSaleRate(sale),
        amount: MONEY(Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)),
        notes: sale.notes || '',
      })),
      ...billPayments.map((paymentRow) => ({
        date: paymentRow.paid_at,
        kind: 'Payment',
        product: 'Payment received',
        quantity: '-',
        rate: '-',
        amount: MONEY(paymentRow.amount_paid),
        notes: paymentRow.notes || '',
      })),
    ].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
    table(doc, {
      startY: tableStartY,
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      head: [['Date', 'Type', 'Product / details', 'Quantity', 'Rate (INR)', 'Amount (INR)', 'Notes']],
      body: transactions.length
        ? transactions.map((row) => [
          formatDateCompact(row.date), row.kind, row.product, row.quantity, row.rate, row.amount, row.notes,
        ])
        : [['-', '-', 'No bills or payments recorded', '-', '-', '-', '']],
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 43 },
        3: { cellWidth: 34, halign: 'right' },
        4: { cellWidth: 60, halign: 'right' },
        5: { cellWidth: 33, halign: 'right' },
        6: { cellWidth: 56 },
      },
    });
  }

  addPageNumbers(doc);
  const filename = `${safeFilename(buyer.name)}_GSM_${realTodayIST()}.pdf`;
  return new File([doc.output('blob')], filename, { type: 'application/pdf' });
}
