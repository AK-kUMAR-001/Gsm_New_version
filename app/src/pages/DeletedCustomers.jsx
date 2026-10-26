import React from 'react';
import { Link } from 'react-router-dom';
import { ArchiveRestore, ArrowRight, Users } from 'lucide-react';
import { useAppData } from '../hooks/useAppData.jsx';
import { currencyINR, formatDateCompact } from '../lib/business.js';
import Avatar from '../components/Avatar.jsx';

export default function DeletedCustomers() {
  const { buyers, balancesById, buyerSales, payments } = useAppData();
  const archivedBuyers = buyers
    .filter((buyer) => buyer.archived_at)
    .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">Archived Customers</h1>
          <p className="mt-1 text-sm text-ink-500">
            Archived customers remain in reports and keep their complete transaction history.
          </p>
        </div>
        <Link to="/buyers" className="btn-outline">
          <Users className="h-4 w-4" />
          Active Buyers
        </Link>
      </div>

      {archivedBuyers.length === 0 ? (
        <div className="rounded-3xl border border-ink-100 bg-white p-12 text-center shadow-card">
          <ArchiveRestore className="mx-auto mb-4 h-10 w-10 text-ink-300" />
          <h2 className="text-lg font-bold text-ink-900">No archived customers</h2>
          <p className="mt-1 text-sm text-ink-500">Customers you archive will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {archivedBuyers.map((buyer) => {
            const balance = balancesById[buyer.id];
            const salesCount = buyerSales.filter((sale) => sale.buyer_id === buyer.id).length;
            const paymentsCount = payments.filter((payment) => payment.buyer_id === buyer.id).length;
            return (
              <article key={buyer.id} className="rounded-3xl border border-ink-100 bg-white p-5 shadow-card">
                <div className="flex items-start gap-3">
                  <Avatar name={buyer.name} sizeClass="h-12 w-12 text-base" ring />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-bold text-ink-900">{buyer.name}</h2>
                    {buyer.phone && <p className="mt-1 text-sm text-ink-500">{buyer.phone}</p>}
                    {buyer.address && <p className="mt-1 truncate text-sm text-ink-500">{buyer.address}</p>}
                    <p className="mt-2 text-xs text-ink-400">
                      Archived {buyer.archived_at ? formatDateCompact(buyer.archived_at) : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Purchases" value={currencyINR(balance?.total_sales || 0)} />
                  <Metric label="Paid" value={currencyINR(balance?.total_paid || 0)} />
                  <Metric label="Due" value={currencyINR(balance?.balance_due || 0)} />
                  <Metric label="History" value={`${salesCount} sales · ${paymentsCount} payments`} />
                </div>
                <Link to={`/buyers/${buyer.id}`} className="btn-outline mt-4 w-full">
                  Full history & details
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-ink-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 truncate text-xs font-extrabold text-ink-900" title={String(value)}>{value}</div>
    </div>
  );
}
