import React, { useEffect, useMemo, useState } from 'react';
import { buildWhatsAppBillUrl, currencyINR, formatUnitQuantities, realTodayIST, saleQuantityUnit } from '../lib/business.js';
import Modal from './Modal.jsx';
import { ArrowLeft, FileText, MessageCircle, Share2 } from 'lucide-react';

function supportsPdfFileShare(file) {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({
      files: [file || new File([''], 'bill.pdf', { type: 'application/pdf' })],
    });
  } catch {
    return false;
  }
}

function createBillMessage({ buyer, sales, payments, balance, kind }) {
  const monthKey = realTodayIST().slice(0, 7);
  const monthName = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const salesForMessage = kind === 'monthly'
    ? sales.filter((sale) => String(sale.sale_date || '').slice(0, 7) === monthKey)
    : sales;
  const paymentsForMessage = kind === 'monthly'
    ? payments.filter((payment) => String(payment.paid_at || '').slice(0, 7) === monthKey)
    : payments;
  const quantities = salesForMessage.reduce((totals, sale) => {
    const unit = saleQuantityUnit(sale);
    totals[unit] = (totals[unit] || 0) + Number(sale.mootais ?? sale.mootais_sold ?? 0);
    return totals;
  }, {});
  const billed = salesForMessage.reduce(
    (sum, sale) => sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0),
    0,
  );
  const paid = paymentsForMessage.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const label = kind === 'monthly' ? `monthly bill for ${monthName}` : 'complete bill';
  const message = [
    `Hi ${buyer.name},`,
    'Greetings from GSM Traders.',
    `Please find your ${label} attached.`,
    `Total quantities: ${formatUnitQuantities(quantities)}`,
    `Total bill: ${currencyINR(billed)}`,
    `${kind === 'monthly' ? 'Received this month' : 'Total received'}: ${currencyINR(paid)}`,
    `Amount pending: ${currencyINR(balance.balance_due)}`,
    'Please let us know if you have any questions. Thank you.',
  ].join('\n');
  return { label, message };
}

export default function BillAlertModal({ open, onClose, buyers, balances, buyerSales, payments }) {
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
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
        url: buildWhatsAppBillUrl(buyer, balance, buyerSales, payments),
      };
    })
    .sort((left, right) => (
      Number(right.balance.balance_due || 0) - Number(left.balance.balance_due || 0)
      || String(left.buyer.name || '').localeCompare(String(right.buyer.name || ''))
    )),
  [buyers, balanceById, buyerSales, payments]);
  const selectedRow = rows.find((row) => row.buyer.id === selectedBuyerId);
  const selectedBuyerSales = (buyerSales || []).filter((sale) => sale.buyer_id === selectedBuyerId);
  const selectedBuyerPayments = (payments || []).filter((payment) => payment.buyer_id === selectedBuyerId);

  const createAndShareBill = async (kind) => {
    if (!selectedRow?.url || !createBuyerBillFile || workingKind) return;
    setWorkingKind(kind);
    setError('');
    setNotice('');

    try {
      const file = createBuyerBillFile({
        buyer: selectedRow.buyer,
        sales: selectedBuyerSales,
        payments: selectedBuyerPayments,
        balance: selectedRow.balance,
        kind,
      });
      const { label, message } = createBillMessage({
        buyer: selectedRow.buyer,
        sales: selectedBuyerSales,
        payments: selectedBuyerPayments,
        balance: selectedRow.balance,
        kind,
      });
      if (!supportsPdfFileShare(file)) {
        throw new Error('This browser cannot share PDF files. Use the existing Download PDF button to download the statement, or open Send Bill on WhatsApp on a phone with file sharing support.');
      }
      await navigator.share({
        files: [file],
        title: `${selectedRow.buyer.name} - ${label}`,
        text: message,
      });
      onClose();
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') {
        setError(`Could not prepare or share the bill: ${shareError.message || 'Unexpected error.'}`);
      }
    } finally {
      setWorkingKind('');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Bill Alert" maxWidth="max-w-2xl">
      {!selectedRow ? (
        <>
          <p className="mb-4 text-sm text-ink-500">
            All {rows.length} buyers are listed. Select a buyer to choose a bill format and share it.
          </p>
          <div className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
            {rows.length ? rows.map(({ buyer, balance, url }) => (
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
                {url ? (
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
                ) : (
                  <span className="shrink-0 text-right text-xs font-semibold text-ink-400">
                    {buyer.phone ? 'Check phone number' : 'Add phone number'}
                  </span>
                )}
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
              setSelectedBuyerId('');
              setError('');
              setNotice('');
            }}
            disabled={!!workingKind}
            className="inline-flex items-center gap-1 text-sm font-semibold text-sidebar-accent disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" /> All buyers
          </button>
          <div className="rounded-2xl bg-ink-50 p-4">
            <p className="font-bold text-ink-900">{selectedRow.buyer.name}</p>
            <p className="mt-1 text-xs text-ink-500">
              Choose a bill to open your device’s share menu with its PDF and greeting message. Pick WhatsApp, email, or another available app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => createAndShareBill('full')}
            disabled={!!workingKind || !createBuyerBillFile}
            className="flex w-full items-center gap-3 rounded-2xl border border-ink-200 p-4 text-left transition hover:border-sidebar-accent hover:bg-ink-50 disabled:opacity-60"
          >
            <FileText className="h-6 w-6 shrink-0 text-sidebar-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink-900">Share complete detailed bill (PDF)</span>
              <span className="block text-xs text-ink-500">All sales and payments with product, quantity, rate, date, notes, and greeting.</span>
            </span>
            {workingKind === 'full' && <span className="text-xs text-ink-500">Preparing…</span>}
            {!createBuyerBillFile && <span className="text-xs text-ink-500">Preparing…</span>}
          </button>
          <button
            type="button"
            onClick={() => createAndShareBill('monthly')}
            disabled={!!workingKind || !createBuyerBillFile}
            className="flex w-full items-center gap-3 rounded-2xl border border-ink-200 p-4 text-left transition hover:border-sidebar-accent hover:bg-ink-50 disabled:opacity-60"
          >
            <Share2 className="h-6 w-6 shrink-0 text-brand-green-dark" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink-900">Share monthly bill (PDF)</span>
              <span className="block text-xs text-ink-500">This month’s product quantities by unit, billed amount, payments, and greeting.</span>
            </span>
            {workingKind === 'monthly' && <span className="text-xs text-ink-500">Preparing…</span>}
            {!createBuyerBillFile && <span className="text-xs text-ink-500">Preparing…</span>}
          </button>
          {notice && <p className="text-sm text-amber-800" role="status">{notice}</p>}
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
