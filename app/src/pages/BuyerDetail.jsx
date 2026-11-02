import React, { useState, useMemo, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  buyerSaleDiscountPercent,
  buyerSaleDiscountTotal,
  buyerSaleFinalTotal,
  buyerSaleOriginalTotal,
  currencyINR,
  dateRangeForPeriod,
  formatDateCompact,
  formatSaleQuantities,
  formatSaleRates,
  getProductEmoji,
  inPeriod,
  realTodayIST,
  shiftDateKey,
} from '../lib/business.js';
import Avatar from '../components/Avatar.jsx';
import PeriodPills, { BUYER_PERIOD_OPTIONS } from '../components/PeriodPills.jsx';
import QuickBuyerEntryModal from '../components/QuickBuyerEntryModal.jsx';
import RecordPaymentModal from '../components/RecordPaymentModal.jsx';
import DeleteBuyerModal from '../components/DeleteBuyerModal.jsx';
import BillAlertModal from '../components/BillAlertModal.jsx';
import BuyerBalanceAdjustmentModal from '../components/BuyerBalanceAdjustmentModal.jsx';
import Modal from '../components/Modal.jsx';
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, IndianRupee, Package, ShoppingBag, Calendar, FileText, Banknote, FileDown, MessageCircle, Archive, ArchiveRestore, Trash2, Pencil } from 'lucide-react';

function movePdfAnchor(period, date, direction) {
  const step = period === 'week' ? 7 : period === '3months' ? 3 : 1;
  const unit = ['month', '3months'].includes(period) ? 'month' : 'day';
  return shiftDateKey(date, direction * step, unit);
}

export default function BuyerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    buyersById,
    balancesById,
    buyerSales,
    payments,
    products,
    balances,
    buyerBalanceAdjustments,
    buyerBalanceAdjustmentError,
    updateBuyerBalance,
    load,
    showToast,
    setBuyerArchived,
  } = useAppData();

  const [period, setPeriod] = useState('month');
  const [activeTab, setActiveTab] = useState('sales');
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pdfPeriodPickerOpen, setPdfPeriodPickerOpen] = useState(false);
  const [pdfDownloadPeriod, setPdfDownloadPeriod] = useState('month');
  const [pdfAnchorDate, setPdfAnchorDate] = useState(realTodayIST());
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [billAlertOpen, setBillAlertOpen] = useState(false);
  const [balanceEditorOpen, setBalanceEditorOpen] = useState(false);

  const buyer = buyersById[id];
  const isArchived = Boolean(buyer?.archived_at);
  const directoryPath = isArchived ? '/buyers/deleted' : '/buyers';
  const balance = balancesById[id];

  useEffect(() => {
    if (isArchived) setPeriod('all');
  }, [isArchived]);

  const changeArchiveState = async (archived) => {
    const result = await setBuyerArchived(id, archived);
    if (!result.error) navigate(archived ? '/buyers/deleted' : '/buyers', { replace: true });
  };

  const filteredSales = useMemo(() => {
    return (buyerSales || [])
      .filter((sale) => sale.buyer_id === id && inPeriod(sale.sale_date, period, 'reports'))
      .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));
  }, [buyerSales, id, period]);

  const filteredPayments = useMemo(() => {
    return (payments || [])
      .filter((payment) => payment.buyer_id === id && inPeriod(payment.paid_at, period, 'reports'))
      .sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
  }, [payments, id, period]);

  const downloadBuyerPdf = async () => {
    if (pdfDownloading) return;
    setPdfDownloading(true);
    try {
      const { createBuyerBillFile } = await import('../lib/pdfReports.js');
      const file = await createBuyerBillFile({
        buyer,
        sales: buyerSales.filter((sale) => sale.buyer_id === id),
        payments: payments.filter((payment) => payment.buyer_id === id),
        balance,
        kind: {
          today: 'custom',
          week: 'week',
          month: 'monthly',
          '3months': '3months',
          all: 'full',
        }[pdfDownloadPeriod],
        selectedDate: pdfAnchorDate,
        anchorDate: pdfAnchorDate,
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPdfPeriodPickerOpen(false);
    } catch (error) {
      showToast(`Could not create PDF: ${error.message || 'Unexpected error.'}`, 'error');
    } finally {
      setPdfDownloading(false);
    }
  };

  if (!buyer) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-ink-500">
        <Package className="w-12 h-12 mb-4 opacity-40" />
        <div className="text-lg font-semibold mb-2">Buyer not found</div>
        <Link to="/buyers" className="btn-primary mt-4">
          <ArrowLeft className="w-4 h-4" />
          Back to Buyers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={directoryPath} className="btn-ghost !px-3">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1" />
        <button onClick={() => load()} className="btn-ghost" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
        {isArchived ? (
          <>
            <span className="rounded-full bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">Archived</span>
            <button type="button" onClick={() => changeArchiveState(false)} className="btn-green">
              <ArchiveRestore className="w-4 h-4" />
              Restore Buyer
            </button>
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              className="btn-outline !px-3 !py-2 text-red-700 hover:bg-red-50"
              title="Permanently delete this archived buyer"
              aria-label={`Permanently delete ${buyer.name}`}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setBillAlertOpen(true)}
              className="btn-green"
              title="Preview and send this buyer's bill on WhatsApp."
            >
              <MessageCircle className="w-4 h-4" />
              Send Bill on WhatsApp
            </button>
            <button onClick={() => setSaleModalOpen(true)} className="btn-navy">
              <ShoppingBag className="w-4 h-4" />
              Record Sale
            </button>
            <button onClick={() => setPaymentModalOpen(true)} className="btn-green">
              <Banknote className="w-4 h-4" />
              Record Payment
            </button>
            <button
              type="button"
              onClick={() => changeArchiveState(true)}
              className="btn-outline !px-3 !py-2"
              title="Archive this buyer without changing history or reports"
              aria-label={`Archive ${buyer.name}`}
            >
              <Archive className="w-4 h-4" />
              Archive
            </button>
          </>
        )}
      </div>

      <div className="rounded-3xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f3460 0%, #16213e 50%, #8200da 100%)' }}>
        <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-brand-green/10 blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center gap-6">
          <Avatar name={buyer.name} sizeClass="w-20 h-20 md:w-24 md:h-24 text-2xl md:text-3xl" ring />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight truncate">{buyer.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-white/80 text-sm">
              {buyer.phone && (
                <div className="flex items-center gap-1.5">
                  <IndianRupee className="w-4 h-4" />
                  <span>{buyer.phone}</span>
                </div>
              )}
              {buyer.address && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span className="truncate">{buyer.address}</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 w-full md:w-auto">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 md:p-4 text-center border border-white/10">
              <div className="text-xs md:text-sm font-semibold text-white/60 uppercase tracking-wide mb-1">Purchases</div>
              <div className="text-amber-300 font-bold text-lg md:text-2xl">{currencyINR(balance?.total_sales || 0)}</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 md:p-4 text-center border border-white/10">
              <div className="text-xs md:text-sm font-semibold text-white/60 uppercase tracking-wide mb-1">Paid</div>
              <div className="text-amber-300 font-bold text-lg md:text-2xl">{currencyINR(balance?.total_paid || 0)}</div>
            </div>
            <div className="bg-amber-400/20 backdrop-blur-sm rounded-2xl p-3 md:p-4 text-center border border-amber-300/30">
              <div className="flex items-center justify-center gap-1.5">
                <div className="text-xs md:text-sm font-semibold text-amber-200/90 uppercase tracking-wide">Balance</div>
                {!isArchived && (
                  <button
                    type="button"
                    onClick={() => setBalanceEditorOpen(true)}
                    title={buyerBalanceAdjustmentError || `Update ${buyer.name}'s balance`}
                    aria-label={`Update ${buyer.name}'s balance`}
                    className="rounded-full p-1 text-red-300 transition hover:bg-white/10 hover:text-red-200"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="mt-1 break-words text-amber-300 font-extrabold text-lg md:text-2xl">
                {currencyINR(balance?.balance_due || 0)}
              </div>
            </div>
            <div className="bg-sky-400/20 backdrop-blur-sm rounded-2xl p-3 md:p-4 text-center border border-sky-300/30">
              <div className="text-xs md:text-sm font-semibold text-sky-100 uppercase tracking-wide mb-1">Credit</div>
              <div className="text-sky-200 font-extrabold text-lg md:text-2xl">{currencyINR(balance?.credit_balance || 0)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="metric-card !p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-500">Last purchase</div>
          <div className="mt-1 font-semibold text-ink-900">
            {balance?.last_purchase ? formatDateCompact(balance.last_purchase) : 'No purchases recorded'}
          </div>
        </div>
        <div className="metric-card !p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-500">Last payment</div>
          <div className="mt-1 font-semibold text-ink-900">
            {balance?.last_payment ? formatDateCompact(balance.last_payment) : 'No payments recorded'}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PeriodPills value={period} onChange={setPeriod} options={BUYER_PERIOD_OPTIONS} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPdfDownloadPeriod(period);
              setPdfAnchorDate(realTodayIST());
              setPdfPeriodPickerOpen(true);
            }}
            className="btn-outline"
          >
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
          <div className="inline-flex p-1 bg-ink-100 rounded-xl">
            <button
              onClick={() => setActiveTab('sales')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'sales' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
            >
              Sales
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${activeTab === 'payments' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
            >
              Payments
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'sales' && (
        <div className="metric-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink-50 text-ink-500">
                  <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Date</th>
                  <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Product</th>
                  <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Quantity</th>
                  <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Rate / unit</th>
                  <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Total</th>
                  <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <div className="flex flex-col items-center text-ink-400">
                        <ShoppingBag className="w-10 h-10 mb-3 opacity-50" />
                        <div className="font-semibold text-ink-600 mb-1">No sales yet</div>
                        <div className="text-sm">Record a sale for this buyer to get started.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((s) => {
                    const total = buyerSaleFinalTotal(s);
                    const originalTotal = buyerSaleOriginalTotal(s);
                    const discountTotal = buyerSaleDiscountTotal(s);
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
                        <td className="px-5 py-4 text-right text-ink-700 font-semibold">{formatSaleQuantities(s, products)}</td>
                        <td className="px-5 py-4 text-right text-ink-600">{formatSaleRates(s, products)}</td>
                        <td className="px-5 py-4 text-right font-bold text-ink-900">
                          {discountTotal > 0 ? (
                            <span title={`Original ${currencyINR(originalTotal)} − discount ${currencyINR(discountTotal)} (${buyerSaleDiscountPercent(s).toFixed(2)}%)`}>
                              <span className="block text-xs font-medium text-ink-500 line-through">{currencyINR(originalTotal)}</span>
                              <span>{currencyINR(total)}</span>
                              <span className="block text-xs font-semibold text-red-700">
                                −{currencyINR(discountTotal)} ({buyerSaleDiscountPercent(s).toFixed(2)}%)
                              </span>
                            </span>
                          ) : currencyINR(total)}
                        </td>
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
      )}

      {activeTab === 'payments' && (
        <div className="metric-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink-50 text-ink-500">
                  <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Date</th>
                  <th className="text-right font-semibold px-5 py-3.5 whitespace-nowrap">Amount</th>
                  <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-16 text-center">
                      <div className="flex flex-col items-center text-ink-400">
                        <Banknote className="w-10 h-10 mb-3 opacity-50" />
                        <div className="font-semibold text-ink-600 mb-1">No payments yet</div>
                        <div className="text-sm">Record a payment from this buyer to get started.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => {
                    const amt = Number(p.amount_paid ?? 0);
                    return (
                      <tr key={p.id} className="border-t border-ink-100 hover:bg-ink-50/50 transition">
                        <td className="px-5 py-4 whitespace-nowrap text-ink-600">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-ink-400" />
                            {formatDateCompact(p.paid_at)}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <span className="inline-flex items-center gap-1.5 font-bold text-brand-green-dark">
                            <IndianRupee className="w-4 h-4" />
                            {currencyINR(amt)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-ink-500 max-w-[360px] truncate" title={p.notes || ''}>
                          {p.notes ? <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />{p.notes}</span> : <span className="text-ink-300">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isArchived && (
        <>
          <QuickBuyerEntryModal open={saleModalOpen} onClose={() => setSaleModalOpen(false)} buyerId={id} />
          <RecordPaymentModal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} buyerId={id} />
          <BillAlertModal
            open={billAlertOpen}
            onClose={() => setBillAlertOpen(false)}
            buyers={[buyer]}
            balances={{ list: balance ? [{ ...balance, id }] : [] }}
            buyerSales={buyerSales}
            payments={payments}
          />
          <BuyerBalanceAdjustmentModal
            open={balanceEditorOpen}
            onClose={() => setBalanceEditorOpen(false)}
            buyer={buyer}
            currentBalance={balance?.balance_due || 0}
            history={buyerBalanceAdjustments.filter((entry) => entry.buyer_id === id)}
            unavailableReason={buyerBalanceAdjustmentError}
            onSave={updateBuyerBalance}
          />
        </>
      )}
      {isArchived && (
        <DeleteBuyerModal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          buyer={buyer}
          onDeleted={() => navigate('/buyers/deleted', { replace: true })}
        />
      )}
      <Modal
        open={pdfPeriodPickerOpen}
        onClose={() => setPdfPeriodPickerOpen(false)}
        title="Choose PDF period"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-600">Choose the date range to include in this buyer PDF.</p>
          <div className="grid grid-cols-2 gap-2">
            {BUYER_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={pdfDownloadPeriod === option.key}
                onClick={() => setPdfDownloadPeriod(option.key)}
                className={`period-pill min-h-11 ${pdfDownloadPeriod === option.key ? 'active' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {pdfDownloadPeriod !== 'all' && (
            <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
              <button
                type="button"
                aria-label="Previous PDF period"
                disabled={!pdfAnchorDate}
                onClick={() => setPdfAnchorDate((date) => movePdfAnchor(pdfDownloadPeriod, date, -1))}
                className="btn-outline !min-h-10 !px-2 !py-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <label className="block min-w-0 text-center text-xs font-semibold text-ink-700">
                {dateRangeForPeriod(pdfDownloadPeriod === 'today' ? 'today' : pdfDownloadPeriod, pdfAnchorDate)?.label || 'Choose a PDF date'}
                <input
                  type="date"
                  value={pdfAnchorDate}
                  max={realTodayIST()}
                  aria-label="Choose PDF period date"
                  onChange={(event) => setPdfAnchorDate(event.target.value)}
                  className="input mt-1 !min-h-10 !py-1.5 text-center text-xs"
                />
              </label>
              <button
                type="button"
                aria-label="Next PDF period"
                disabled={!pdfAnchorDate || movePdfAnchor(pdfDownloadPeriod, pdfAnchorDate, 1) > realTodayIST()}
                onClick={() => setPdfAnchorDate((date) => movePdfAnchor(pdfDownloadPeriod, date, 1))}
                className="btn-outline !min-h-10 !px-2 !py-2"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={() => setPdfPeriodPickerOpen(false)}
              disabled={pdfDownloading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-green"
              onClick={downloadBuyerPdf}
              disabled={pdfDownloading || (pdfDownloadPeriod !== 'all' && !pdfAnchorDate)}
            >
              <FileDown className="h-4 w-4" />
              {pdfDownloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
