import React, { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAppData.jsx';
import {
  currencyINR,
  formatDateCompact,
  formatSaleQuantities,
  formatSaleRates,
  getProductEmoji,
  inPeriod,
} from '../lib/business.js';
import Avatar from '../components/Avatar.jsx';
import PeriodPills from '../components/PeriodPills.jsx';
import QuickBuyerEntryModal from '../components/QuickBuyerEntryModal.jsx';
import RecordPaymentModal from '../components/RecordPaymentModal.jsx';
import DeleteBuyerModal from '../components/DeleteBuyerModal.jsx';
import ConfirmDownloadModal from '../components/ConfirmDownloadModal.jsx';
import BillAlertModal from '../components/BillAlertModal.jsx';
import { ArrowLeft, RefreshCw, IndianRupee, Package, ShoppingBag, Calendar, Banknote, FileDown, MessageCircle, Trash2, ChevronDown } from 'lucide-react';

export default function BuyerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { buyersById, balancesById, buyerSales, payments, products, balances, load, showToast } = useAppData();

  const [period, setPeriod] = useState('month');
  const [expandedHistory, setExpandedHistory] = useState('');
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pdfConfirmOpen, setPdfConfirmOpen] = useState(false);
  const [billAlertOpen, setBillAlertOpen] = useState(false);

  const buyer = buyersById[id];
  const balance = balancesById[id];

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

  const dailyHistory = useMemo(() => {
    const days = new Map();
    const getDay = (date) => {
      if (!days.has(date)) days.set(date, { date, sales: [], payments: [] });
      return days.get(date);
    };
    for (const sale of filteredSales) getDay(String(sale.sale_date || '').slice(0, 10)).sales.push(sale);
    for (const payment of filteredPayments) getDay(String(payment.paid_at || '').slice(0, 10)).payments.push(payment);
    return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredSales, filteredPayments]);

  const toggleHistory = (key) => {
    setExpandedHistory((current) => current === key ? '' : key);
  };

  const downloadBuyerPdf = async () => {
    try {
      const { downloadBuyerStatementPdf } = await import('../lib/pdfReports.js');
      downloadBuyerStatementPdf({
        period,
        buyer,
        sales: filteredSales,
        payments: filteredPayments,
        balance,
      });
    } catch (error) {
      showToast(`Could not create PDF: ${error.message || 'Unexpected error.'}`, 'error');
      throw error;
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
        <Link to="/buyers" className="btn-ghost !px-3">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1" />
        <button onClick={() => load()} className="btn-ghost" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
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
          onClick={() => setDeleteModalOpen(true)}
          className="btn-outline !px-3 !py-2 text-red-700 hover:bg-red-50"
          title="Delete this buyer and all linked records"
          aria-label={`Delete ${buyer.name} and all linked records`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
              <div className="text-xs md:text-sm font-semibold text-amber-200/90 uppercase tracking-wide mb-1">Due</div>
              <div className="text-amber-300 font-extrabold text-lg md:text-2xl">{currencyINR(balance?.balance_due || 0)}</div>
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
        <PeriodPills value={period} onChange={setPeriod} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPdfConfirmOpen(true)}
            className="btn-outline"
          >
            <FileDown className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>

      <section className="space-y-3">
        {dailyHistory.length === 0 ? (
          <div className="metric-card flex flex-col items-center py-12 text-center text-ink-500">
            <ShoppingBag className="mb-3 h-10 w-10 opacity-40" />
            <p className="font-semibold text-ink-700">No sales or payments in this period</p>
          </div>
        ) : dailyHistory.map(({ date, sales: daySales, payments: dayPayments }) => {
          const salesTotal = daySales.reduce((sum, sale) => (
            sum + Number(sale.mootais ?? sale.mootais_sold ?? 0) * Number(sale.price_per_mootai ?? 0)
          ), 0);
          const paymentsTotal = dayPayments.reduce((sum, payment) => sum + Number(payment.amount_paid ?? 0), 0);
          const isExpanded = expandedHistory === date;
          return (
            <article key={date} className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleHistory(date)}
                className="grid w-full grid-cols-1 items-center gap-3 p-4 text-left transition hover:bg-ink-50 sm:grid-cols-[minmax(130px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:px-5"
              >
                <span className="flex items-center gap-2 font-bold text-ink-900">
                  <Calendar className="h-4 w-4 shrink-0 text-ink-400" />
                  {formatDateCompact(date)}
                </span>
                <span className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 sm:bg-transparent sm:p-0">
                  <span className="flex items-center gap-2 text-sm text-ink-600">
                    <ShoppingBag className="h-4 w-4 text-brand-green-dark" />
                    Sales · {daySales.length}
                  </span>
                  <span className="font-bold text-ink-900">{currencyINR(salesTotal)}</span>
                </span>
                <span className="flex items-center justify-between gap-3 rounded-lg bg-green-50 px-3 py-2 sm:bg-transparent sm:p-0">
                  <span className="flex items-center gap-2 text-sm text-ink-600">
                    <Banknote className="h-4 w-4 text-green-700" />
                    Payments · {dayPayments.length}
                  </span>
                  <span className="font-bold text-green-700">{currencyINR(paymentsTotal)}</span>
                </span>
                <ChevronDown className={`hidden h-5 w-5 text-ink-500 transition-transform sm:block ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isExpanded && (
                <div className="grid grid-cols-1 gap-3 border-t border-ink-100 bg-ink-50/50 p-3 sm:grid-cols-2 sm:p-4">
                  <section className="overflow-hidden rounded-xl border border-ink-100 bg-white">
                    <h3 className="flex items-center justify-between border-b border-ink-100 px-4 py-3 font-semibold text-ink-800">
                      <span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-brand-green-dark" /> Sales</span>
                      <span className="text-sm font-bold text-ink-900">{currencyINR(salesTotal)}</span>
                    </h3>
                    {daySales.length ? daySales.map((sale) => {
                      const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
                      const rate = Number(sale.price_per_mootai ?? 0);
                      return (
                        <div key={sale.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-3 last:border-b-0">
                          <span className="flex min-w-0 items-center gap-2 font-semibold text-ink-900">
                            <span>{getProductEmoji(sale.product, products)}</span>
                            <span className="truncate">{sale.product || '(Unknown)'}</span>
                          </span>
                          <span className="row-span-2 text-right font-bold text-ink-900">{currencyINR(quantity * rate)}</span>
                          <span className="text-xs text-ink-500">{formatSaleQuantities(sale, products)} · {formatSaleRates(sale, products)}</span>
                        </div>
                      );
                    }) : <p className="px-4 py-4 text-sm text-ink-500">No sales recorded.</p>}
                  </section>
                  <section className="overflow-hidden rounded-xl border border-ink-100 bg-white">
                    <h3 className="flex items-center justify-between border-b border-ink-100 px-4 py-3 font-semibold text-ink-800">
                      <span className="flex items-center gap-2"><Banknote className="h-4 w-4 text-green-700" /> Payments received</span>
                      <span className="text-sm font-bold text-green-700">{currencyINR(paymentsTotal)}</span>
                    </h3>
                    {dayPayments.length ? dayPayments.map((payment) => (
                      <div key={payment.id} className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-b-0">
                        <span className="flex-1 text-sm text-ink-700">Payment received</span>
                        <span className="font-bold text-green-700">{currencyINR(payment.amount_paid)}</span>
                      </div>
                    )) : <p className="px-4 py-4 text-sm text-ink-500">No payments recorded.</p>}
                  </section>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <QuickBuyerEntryModal open={saleModalOpen} onClose={() => setSaleModalOpen(false)} buyerId={id} />
      <RecordPaymentModal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} buyerId={id} />
      <DeleteBuyerModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        buyer={buyer}
        onDeleted={() => navigate('/buyers', { replace: true })}
      />
      <ConfirmDownloadModal
        open={pdfConfirmOpen}
        fileLabel="this buyer statement PDF"
        onClose={() => setPdfConfirmOpen(false)}
        onConfirm={downloadBuyerPdf}
      />
      <BillAlertModal
        open={billAlertOpen}
        onClose={() => setBillAlertOpen(false)}
        buyers={[buyer]}
        balances={{ list: balance ? [{ ...balance, id }] : [] }}
        buyerSales={buyerSales}
        payments={payments}
      />
    </div>
  );
}
