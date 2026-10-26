import React, { useEffect, useMemo, useState } from 'react';
import {
  currencyINR,
  formatDateCompact,
  formatQuantity,
  formatQuantityByUnit,
  realTodayIST,
  saleQuantityUnit,
  startOfWeekIST,
} from '../lib/business.js';
import Modal from './Modal.jsx';
import { ArrowLeft, Download, MessageCircle } from 'lucide-react';

function downloadBillFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeWhatsAppPhone(phone) {
  let normalized = String(phone || '').replace(/\D/g, '');
  if (normalized.startsWith('0') && normalized.length === 11) normalized = normalized.slice(1);
  if (normalized.length === 10) normalized = `91${normalized}`;
  return normalized.length >= 11 && normalized.length <= 15 ? normalized : '';
}

function periodRange(period, selectedDate) {
  const today = realTodayIST();
  if (period === 'today') return { start: selectedDate, end: selectedDate, label: formatDateCompact(selectedDate) };
  if (period === 'week') {
    return { start: startOfWeekIST('reports'), end: today, label: `This week (${formatDateCompact(startOfWeekIST('reports'))} - ${formatDateCompact(today)})` };
  }
  if (period === 'month') {
    const start = `${today.slice(0, 7)}-01`;
    return { start, end: today, label: `This month (${formatDateCompact(start)} - ${formatDateCompact(today)})` };
  }
  return { start: '', end: today, label: 'Complete bill' };
}

function createTextBillUrl({ buyer, sales, payments, balance, period, selectedDate }) {
  const phone = normalizeWhatsAppPhone(buyer?.phone);
  if (!phone || (period === 'today' && !selectedDate)) return '';
  const range = periodRange(period, selectedDate);
  const inRange = (value) => {
    const date = String(value || '').slice(0, 10);
    return date && date <= range.end && (!range.start || date >= range.start);
  };
  const salesInPeriod = sales.filter((sale) => inRange(sale.sale_date));
  const paymentsInPeriod = payments.filter((payment) => inRange(payment.paid_at));
  const quantities = {};
  const entries = [
    ...salesInPeriod.map((sale) => {
      const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
      const unit = saleQuantityUnit(sale);
      quantities[unit] = (quantities[unit] || 0) + quantity;
      const rate = Number(sale.price_per_mootai || 0);
      return {
        date: String(sale.sale_date || '').slice(0, 10),
        text: `${formatDateCompact(sale.sale_date)} · ${sale.product || 'Sale'} · ${formatQuantity(quantity)} ${unit} × ${currencyINR(rate)}/${unit} = ${currencyINR(quantity * rate)}`,
      };
    }),
    ...paymentsInPeriod.map((payment) => ({
      date: String(payment.paid_at || '').slice(0, 10),
      text: `${formatDateCompact(payment.paid_at)} · Payment received · ${currencyINR(payment.amount_paid)}`,
    })),
  ].sort((left, right) => left.date.localeCompare(right.date));
  const billed = salesInPeriod.reduce((sum, sale) => (
    sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0)
  ), 0);
  const paid = paymentsInPeriod.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const message = [
    `Hi ${buyer.name},`,
    `GSM Traders - ${range.label}`,
    '',
    ...(entries.length ? entries.map((entry) => entry.text) : ['No sales or payments recorded for this period.']),
    '',
    `Quantity: ${formatQuantityByUnit(quantities) || '0'}`,
    `Bill total: ${currencyINR(billed)}`,
    `Payments received: ${currencyINR(paid)}`,
    `Current amount pending: ${currencyINR(balance?.balance_due)}`,
    'Thank you.',
  ].join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function BillAlertModal({ open, onClose, buyers, balances, buyerSales, payments }) {
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [sendMode, setSendMode] = useState('');
  const [textPeriod, setTextPeriod] = useState('today');
  const [selectedDate, setSelectedDate] = useState(realTodayIST());
  const [pdfPeriod, setPdfPeriod] = useState('custom');
  const [pdfDate, setPdfDate] = useState(realTodayIST());
  const [downloadedPdfKey, setDownloadedPdfKey] = useState('');
  const [workingKind, setWorkingKind] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createBuyerBillFile, setCreateBuyerBillFile] = useState(null);

  useEffect(() => {
    if (!open || createBuyerBillFile) return undefined;
    let cancelled = false;
    import('../lib/pdfReports.js')
      .then((pdfReports) => {
        if (!cancelled) setCreateBuyerBillFile(() => pdfReports.createBuyerBillFile);
      })
      .catch((loadError) => {
        if (!cancelled) setError(`Could not load bill PDF tools: ${loadError.message || 'Unexpected error.'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [open, createBuyerBillFile]);

  useEffect(() => {
    if (!open) {
      setSelectedBuyerId('');
      setSendMode('');
      setTextPeriod('today');
      setSelectedDate(realTodayIST());
      setPdfPeriod('custom');
      setPdfDate(realTodayIST());
      setDownloadedPdfKey('');
      setWorkingKind('');
      setError('');
      setNotice('');
    }
  }, [open]);

  const balanceById = useMemo(
    () => new Map((balances?.list || []).map((balance) => [balance.id, balance])),
    [balances]
  );
  const rows = useMemo(() => (buyers || [])
    .map((buyer) => {
      const balance = balanceById.get(buyer.id) || {
        balance_due: 0,
        total_sales: 0,
        total_paid: 0,
        credit_balance: 0,
      };
      return {
        buyer,
        balance,
      };
    })
    .sort((left, right) => (
      Number(right.balance.balance_due || 0) - Number(left.balance.balance_due || 0)
      || String(left.buyer.name || '').localeCompare(String(right.buyer.name || ''))
    )),
  [buyers, balanceById]);
  const selectedRow = rows.find((row) => row.buyer.id === selectedBuyerId);
  const selectedBuyerSales = (buyerSales || []).filter((sale) => sale.buyer_id === selectedBuyerId);
  const selectedBuyerPayments = (payments || []).filter((payment) => payment.buyer_id === selectedBuyerId);
  const textBillUrl = selectedRow
    ? createTextBillUrl({
      buyer: selectedRow.buyer,
      sales: selectedBuyerSales,
      payments: selectedBuyerPayments,
      balance: selectedRow.balance,
      period: textPeriod,
      selectedDate,
    })
    : '';
  const pdfPeriodKey = `${pdfPeriod}:${pdfDate}`;
  const whatsappPdfUrl = selectedRow
    ? (() => {
      const phone = normalizeWhatsAppPhone(selectedRow.buyer.phone);
      if (!phone) return '';
      const label = pdfPeriod === 'custom'
        ? formatDateCompact(pdfDate)
        : periodRange(pdfPeriod === 'monthly' ? 'month' : pdfPeriod === 'full' ? 'full' : pdfPeriod).label;
      const message = `Hi ${selectedRow.buyer.name}, this is your's GSM Traders bill for ${label}.`;
      return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    })()
    : '';

  const createAndDownloadBill = async () => {
    if (pdfPeriod === 'custom' && !pdfDate) {
      setError('Choose a bill date.');
      return;
    }
    if (!selectedRow || !createBuyerBillFile || workingKind) return;
    setWorkingKind(pdfPeriod);
    setDownloadedPdfKey('');
    setError('');
    setNotice('');

    try {
      const file = await createBuyerBillFile({
        buyer: selectedRow.buyer,
        sales: selectedBuyerSales,
        payments: selectedBuyerPayments,
        balance: selectedRow.balance,
        kind: pdfPeriod === 'custom' ? 'custom' : pdfPeriod,
        selectedDate: pdfDate,
      });
      downloadBillFile(file);
      setDownloadedPdfKey(pdfPeriodKey);
      setNotice('The PDF bill has been downloaded.');
    } catch (shareError) {
      setError(`Could not prepare or download the bill: ${shareError.message || 'Unexpected error.'}`);
    } finally {
      setWorkingKind('');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Bill Alert" maxWidth="max-w-2xl">
      {!selectedRow ? (
        <>
          <p className="mb-4 text-sm text-ink-500">
            All {rows.length} buyers are listed. Select a buyer to send a text bill or download a PDF.
          </p>
          <div className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
            {rows.length ? rows.map(({ buyer, balance }) => (
              <div key={buyer.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink-900">{buyer.name}</div>
                  <div className="text-xs text-ink-500">
                    {buyer.phone || 'No phone number'}
                    {' · '}
                    {Number(balance.balance_due) > 0
                      ? `Pending ${currencyINR(balance.balance_due)}`
                      : Number(balance.credit_balance) > 0
                        ? `Credit ${currencyINR(balance.credit_balance)}`
                        : 'No pending bill'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBuyerId(buyer.id);
                    setError('');
                    setNotice('');
                  }}
                  className="btn-green shrink-0"
                >
                  <MessageCircle className="h-4 w-4" /> Send bill
                </button>
              </div>
            )) : (
              <p className="py-8 text-center text-sm text-ink-500">No buyers found.</p>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              if (sendMode) setSendMode('');
              else setSelectedBuyerId('');
              setError('');
              setNotice('');
            }}
            disabled={!!workingKind}
            className="inline-flex items-center gap-1 text-sm font-semibold text-sidebar-accent disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" /> {sendMode ? 'Bill options' : 'All buyers'}
          </button>
          <div className="rounded-2xl bg-ink-50 p-4">
            <p className="font-bold text-ink-900">{selectedRow.buyer.name}</p>
            <p className="mt-1 text-xs text-ink-500">
              {sendMode === 'text'
                ? 'Choose the dates for the text bill, then open the prepared message in WhatsApp.'
                : sendMode === 'pdf'
                  ? 'Choose a PDF bill to download.'
                  : 'Choose how you want to send the bill.'}
            </p>
          </div>
          {!sendMode && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setSendMode('text')} className="flex items-center gap-3 rounded-2xl border border-ink-200 p-4 text-left transition hover:border-sidebar-accent hover:bg-ink-50">
                <MessageCircle className="h-6 w-6 shrink-0 text-brand-green-dark" />
                <span><span className="block font-bold text-ink-900">Text Bill</span><span className="block text-xs text-ink-500">Send bill details in WhatsApp</span></span>
              </button>
              <button type="button" onClick={() => setSendMode('pdf')} className="flex items-center gap-3 rounded-2xl border border-ink-200 p-4 text-left transition hover:border-sidebar-accent hover:bg-ink-50">
                <Download className="h-6 w-6 shrink-0 text-sidebar-accent" />
                <span><span className="block font-bold text-ink-900">PDF Download Bill</span><span className="block text-xs text-ink-500">Download a detailed bill PDF</span></span>
              </button>
            </div>
          )}
          {sendMode === 'text' && (
            <div className="space-y-3">
              {[
                ['today', `Today (${formatDateCompact(selectedDate)})`],
                ['week', 'This week'],
                ['month', 'This month'],
                ['full', 'Complete bill'],
              ].map(([period, label]) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setTextPeriod(period)}
                  className={`w-full rounded-xl border p-3 text-left font-semibold transition ${textPeriod === period ? 'border-sidebar-accent bg-sidebar-accent/5 text-sidebar-accent' : 'border-ink-200 text-ink-700 hover:bg-ink-50'}`}
                >
                  {label}
                </button>
              ))}
              {textPeriod === 'today' && (
                <label className="block text-sm font-semibold text-ink-700">
                  Bill date
                  <input
                    type="date"
                    value={selectedDate}
                    max={realTodayIST()}
                    onChange={(event) => setSelectedDate(event.target.value)}
                    className="input mt-1"
                  />
                </label>
              )}
              {!normalizeWhatsAppPhone(selectedRow.buyer.phone) && (
                <p className="text-sm text-red-700" role="alert">
                  Add a valid phone number to send a WhatsApp text bill. PDF downloads are still available.
                </p>
              )}
              {textPeriod === 'today' && !selectedDate && (
                <p className="text-sm text-red-700" role="alert">Choose a bill date.</p>
              )}
              <a
                href={textBillUrl || undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (textBillUrl) onClose();
                }}
                aria-disabled={!textBillUrl}
                className={`btn-green w-full justify-center ${!textBillUrl ? 'pointer-events-none opacity-50' : ''}`}
              >
                <MessageCircle className="h-4 w-4" /> Send message
              </a>
            </div>
          )}
          {sendMode === 'pdf' && (
            <div className="space-y-3">
              {[
                ['custom', `Custom date (${formatDateCompact(pdfDate)})`],
                ['week', 'This week'],
                ['monthly', 'This month'],
                ['full', 'Complete bill'],
              ].map(([period, label]) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => {
                    setPdfPeriod(period);
                    setDownloadedPdfKey('');
                  }}
                  className={`w-full rounded-xl border p-3 text-left font-semibold transition ${pdfPeriod === period ? 'border-sidebar-accent bg-sidebar-accent/5 text-sidebar-accent' : 'border-ink-200 text-ink-700 hover:bg-ink-50'}`}
                >
                  {label}
                </button>
              ))}
              {pdfPeriod === 'custom' && (
                <label className="block text-sm font-semibold text-ink-700">
                  Bill date
                  <input
                    type="date"
                    value={pdfDate}
                    max={realTodayIST()}
                    onChange={(event) => {
                      setPdfDate(event.target.value);
                      setDownloadedPdfKey('');
                    }}
                    className="input mt-1"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={createAndDownloadBill}
                disabled={!!workingKind || !createBuyerBillFile || (pdfPeriod === 'custom' && !pdfDate)}
                className="btn-green w-full justify-center disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {workingKind ? 'Preparing…' : 'Download PDF bill'}
              </button>
              {!createBuyerBillFile && <span className="text-xs text-ink-500">Preparing PDF tools…</span>}
              {downloadedPdfKey === pdfPeriodKey && (
                <>
                  {!whatsappPdfUrl ? (
                    <p className="text-sm text-red-700" role="alert">
                      The PDF was downloaded, but this buyer does not have a valid phone number for WhatsApp.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-ink-500">
                        PDF saved to Downloads. Open the buyer’s WhatsApp chat, then attach the PDF from Downloads.
                      </p>
                      <a
                        href={whatsappPdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-green w-full justify-center"
                      >
                        <MessageCircle className="h-4 w-4" /> Open WhatsApp chat
                      </a>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {notice && <p className="text-sm text-amber-800" role="status">{notice}</p>}
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
