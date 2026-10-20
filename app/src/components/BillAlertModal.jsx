import React, { useEffect, useMemo, useState } from 'react';
import {
  buildWhatsAppBillUrl,
  currencyINR,
  formatQuantityByUnit,
  normalizeWhatsAppPhone,
  realTodayIST,
  saleQuantitiesByUnit,
} from '../lib/business.js';
import Modal from './Modal.jsx';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL, supabase } from '../lib/supabase.js';

function createBillMessage({ buyer, sales, payments, balance, kind }) {
  const monthKey = realTodayIST().slice(0, 7);
  const monthName = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const salesForMessage = kind === 'monthly'
    ? sales.filter((sale) => String(sale.sale_date || '').slice(0, 7) === monthKey)
    : sales;
  const paymentsForMessage = kind === 'monthly'
    ? payments.filter((payment) => String(payment.paid_at || '').slice(0, 7) === monthKey)
    : payments;
  const quantities = {};
  for (const sale of salesForMessage) {
    for (const [unit, quantity] of Object.entries(saleQuantitiesByUnit(sale))) {
      quantities[unit] = (quantities[unit] || 0) + quantity;
    }
  }
  const billed = salesForMessage.reduce(
    (sum, sale) => sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai || 0),
    0,
  );
  const paid = paymentsForMessage.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
  const message = [
    `Hi ${buyer.name},`,
    'Greetings from GSM Traders.',
    `Please find your ${kind === 'monthly' ? `monthly bill for ${monthName}` : 'complete bill'} attached.`,
    `Total quantity: ${formatQuantityByUnit(quantities)}`,
    `Total bill: ${currencyINR(billed)}`,
    `${kind === 'monthly' ? 'Received this month' : 'Total received'}: ${currencyINR(paid)}`,
    `Amount pending: ${currencyINR(balance.balance_due)}`,
    'Please let us know if you have any questions. Thank you.',
  ].join('\n');
  return message;
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

  const createBillFile = (kind) => createBuyerBillFile({
    buyer: selectedRow.buyer,
    sales: selectedBuyerSales,
    payments: selectedBuyerPayments,
    balance: selectedRow.balance,
    kind,
  });

  const createAndSendBill = async (kind) => {
    if (!selectedRow?.url || !createBuyerBillFile || workingKind) return;
    setWorkingKind(kind);
    setError('');
    setNotice('');

    try {
      if (!SUPABASE_CONFIGURED || !supabase) {
        throw new Error('WhatsApp bill sending is not configured. Connect the app to its Supabase project first.');
      }
      const recipient = normalizeWhatsAppPhone(selectedRow.buyer.phone);
      if (!recipient) {
        throw new Error('This customer’s phone number is invalid. Update it before sending the bill.');
      }

      const file = createBillFile(kind);
      const message = createBillMessage({
        buyer: selectedRow.buyer,
        sales: selectedBuyerSales,
        payments: selectedBuyerPayments,
        balance: selectedRow.balance,
        kind,
      });
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        throw new Error('Your session has expired. Sign in again before sending a bill.');
      }

      const form = new FormData();
      form.append('file', file, file.name);
      form.append('to', recipient);
      form.append('caption', message);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-bill`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `WhatsApp send failed (${response.status}).`);
      }

      setNotice(`WhatsApp accepted the ${kind === 'monthly' ? 'monthly' : 'complete'} bill for ${selectedRow.buyer.name} (${selectedRow.buyer.phone}).`);
    } catch (sendError) {
      setError(`Could not send the bill: ${sendError.message || 'Unexpected error.'}`);
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
            <p className="mt-1 text-xs text-ink-500">{selectedRow.buyer.phone}</p>
            <p className="mt-2 text-xs text-ink-500">
              The PDF will be sent directly to this saved number from your connected WhatsApp Business account. No download or contact selection is needed.
            </p>
          </div>
          <div className="space-y-3 rounded-2xl border border-ink-200 p-4">
            <div>
              <p className="font-bold text-ink-900">Complete detailed bill</p>
              <p className="text-xs text-ink-500">All sales and payments with product, quantity, rate, date, and notes.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => createAndSendBill('full')}
                disabled={!!workingKind || !createBuyerBillFile}
                className="btn-green disabled:opacity-60"
              >
                <MessageCircle className="h-4 w-4" />
                {workingKind === 'full' ? 'Sending…' : 'Send complete PDF on WhatsApp'}
              </button>
            </div>
          </div>
          <div className="space-y-3 rounded-2xl border border-ink-200 p-4">
            <div>
              <p className="font-bold text-ink-900">Monthly bill</p>
              <p className="text-xs text-ink-500">This month’s product quantities by unit, billed amount, and payments.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => createAndSendBill('monthly')}
                disabled={!!workingKind || !createBuyerBillFile}
                className="btn-green disabled:opacity-60"
              >
                <MessageCircle className="h-4 w-4" />
                {workingKind === 'monthly' ? 'Sending…' : 'Send monthly PDF on WhatsApp'}
              </button>
            </div>
          </div>
          {notice && <p className="text-sm text-green-800" role="status">{notice}</p>}
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
