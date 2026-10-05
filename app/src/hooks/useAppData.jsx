import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './useAuth.jsx';
import {
  fetchAllPaginated,
  computeBuyerBalances,
  computeProductRevenue,
  todayFigures,
  buildRecentActivity,
  inPeriod,
  setRefToday,
  dataRefDate,
} from '../lib/business.js';

import raw_buyers from '../data/raw_buyers.json';
import raw_products from '../data/raw_products.json';
import raw_buyer_sales from '../data/raw_buyer_sales.json';
import raw_retail_sales from '../data/raw_retail_sales.json';
import raw_payments_a from '../data/raw_buyer_payments.json';
import raw_suppliers from '../data/raw_suppliers.json';

const AppDataContext = createContext(null);

const OFFLINE = {
  buyers: raw_buyers,
  products: raw_products,
  suppliers: raw_suppliers,
  buyerSales: raw_buyer_sales,
  retailSales: raw_retail_sales,
  payments: raw_payments_a,
};

function isDemoModeOn() {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') return true;
    return localStorage.getItem('gsm_demo') === '1';
  } catch (e) {
    return false;
  }
}

async function safeFetch(table, fallback, forceOffline) {
  if (forceOffline) return fallback;
  try {
    const res = await fetchAllPaginated(supabase, table);
    if (res.error || !res.data) throw new Error(res.error?.message || 'no data');
    if (Array.isArray(res.data) && res.data.length === 0 && Array.isArray(fallback) && fallback.length > 0) {
      return fallback;
    }
    return res.data;
  } catch (e) {
    return fallback;
  }
}

export function AppDataProvider({ children }) {
  const auth = useAuth();
  const initialOffline = isDemoModeOn();
  const [buyers, setBuyers] = useState(initialOffline ? OFFLINE.buyers : []);
  const [products, setProducts] = useState(initialOffline ? OFFLINE.products : []);
  const [suppliers, setSuppliers] = useState(initialOffline ? OFFLINE.suppliers : []);
  const [buyerSales, setBuyerSales] = useState(initialOffline ? OFFLINE.buyerSales : []);
  const [retailSales, setRetailSales] = useState(initialOffline ? OFFLINE.retailSales : []);
  const [payments, setPayments] = useState(initialOffline ? OFFLINE.payments : []);
  const [loading, setLoading] = useState(!initialOffline);
  const [offline, setOffline] = useState(initialOffline);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToast({ id, message, kind });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 3200);
  }, []);

  const forceOffline = offline || !!auth?.isDemo || initialOffline;

  const load = useCallback(async () => {
    let b, p, s, bs, rs, pay;
    if (forceOffline) {
      b = OFFLINE.buyers;
      p = OFFLINE.products;
      s = OFFLINE.suppliers;
      bs = OFFLINE.buyerSales;
      rs = OFFLINE.retailSales;
      pay = OFFLINE.payments;
      setOffline(true);
    } else {
      setLoading(true);
      [b, p, s, bs, rs, pay] = await Promise.all([
        safeFetch('buyers', OFFLINE.buyers, false),
        safeFetch('products', OFFLINE.products, false),
        safeFetch('suppliers', OFFLINE.suppliers, false),
        safeFetch('buyer_sales', OFFLINE.buyerSales, false),
        safeFetch('retail_sales', OFFLINE.retailSales, false),
        (async () => {
          try {
            const res = await fetchAllPaginated(supabase, 'buyer_payments');
            if (res.data && res.data.length) return res.data;
            const res2 = await fetchAllPaginated(supabase, 'payments');
            if (res2.data && res2.data.length) return res2.data;
            return OFFLINE.payments;
          } catch (e) {
            return OFFLINE.payments;
          }
        })(),
      ]);
      const anyFallback =
        b === OFFLINE.buyers ||
        bs === OFFLINE.buyerSales ||
        rs === OFFLINE.retailSales;
      setOffline(anyFallback);
    }
    setRefToday(dataRefDate(bs, rs, pay));
    setBuyers(b);
    setProducts(p);
    setSuppliers(s);
    setBuyerSales(bs);
    setRetailSales(rs);
    setPayments(pay);
    setLoading(false);
  }, [forceOffline]);

  useEffect(() => {
    load();
  }, [load]);

  const buyersById = useMemo(() => {
    const m = {};
    for (const b of buyers) m[b.id] = b;
    return m;
  }, [buyers]);

  const balances = useMemo(
    () => computeBuyerBalances(buyers, buyerSales, payments),
    [buyers, buyerSales, payments]
  );

  const balancesById = useMemo(() => {
    const m = {};
    for (const e of balances.list) m[e.id] = e;
    return m;
  }, [balances]);

  const productRevenue = useMemo(
    () => computeProductRevenue(buyerSales, retailSales),
    [buyerSales, retailSales]
  );

  const today = useMemo(
    () => todayFigures(buyerSales, retailSales, payments),
    [buyerSales, retailSales, payments]
  );

  const recent = useMemo(
    () => buildRecentActivity(buyerSales, payments, buyersById, 8),
    [buyerSales, payments, buyersById]
  );

  const activeProducts = useMemo(
    () => products.filter((p) => p.active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [products]
  );

  const insertBuyer = async (input) => {
    if (offline) {
      showToast('Demo mode — edits disabled. Log in to Supabase to save.', 'warn');
      return { error: new Error('offline') };
    }
    const payload = { name: input.name, phone: input.phone || null, address: input.address || null };
    const { data, error } = await supabase.from('buyers').insert([payload]).select();
    if (error) { showToast('Could not save buyer: ' + error.message, 'error'); return { error }; }
    if (data && data[0]) setBuyers((prev) => [...prev, data[0]]);
    showToast('Buyer added', 'success');
    return { data: data?.[0] };
  };

  const updateBuyer = async (id, patch) => {
    if (offline) { showToast('Demo mode — edits disabled.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('buyers').update(patch).eq('id', id).select();
    if (error) { showToast('Could not update buyer: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setBuyers((prev) => prev.map((b) => (b.id === id ? { ...b, ...data[0] } : b)));
    showToast('Buyer updated', 'success');
    return { data: data?.[0] };
  };

  const updateProduct = async (id, patch) => {
    if (offline) { showToast('Demo mode — edits disabled.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('products').update(patch).eq('id', id).select();
    if (error) { showToast('Could not update product: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...data[0] } : p)));
    showToast('Product saved', 'success');
    return { data: data?.[0] };
  };

  const insertBuyerSale = async (row) => {
    if (offline) { showToast('Demo mode — edits disabled.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('buyer_sales').insert([row]).select();
    if (error) { showToast('Could not save sale: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setBuyerSales((prev) => [data[0], ...prev]);
    showToast('Sale recorded', 'success');
    return { data: data?.[0] };
  };

  const insertPayment = async (row) => {
    if (offline) { showToast('Demo mode — edits disabled.', 'warn'); return { error: new Error('offline') }; }
    const tables = ['buyer_payments', 'payments'];
    for (const tbl of tables) {
      try {
        const { data, error } = await supabase.from(tbl).insert([row]).select();
        if (error && tbl !== tables.at(-1)) continue;
        if (error) { showToast('Could not save payment: ' + error.message, 'error'); return { error }; }
        if (data?.[0]) setPayments((prev) => [data[0], ...prev]);
        showToast('Payment recorded', 'success');
        return { data: data?.[0] };
      } catch (e) { /* continue to fallback table */ }
    }
    return { error: new Error('failed') };
  };

  const insertRetailSale = async (row) => {
    if (offline) { showToast('Demo mode — edits disabled.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('retail_sales').insert([row]).select();
    if (error) { showToast('Could not save retail sale: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setRetailSales((prev) => [data[0], ...prev]);
    showToast('Retail sale recorded', 'success');
    return { data: data?.[0] };
  };

  const filterByPeriod = useCallback((rows, period, dateField) => {
    if (period === 'all' || !period) return rows;
    return (rows || []).filter((r) => inPeriod(r[dateField], period, 'dashboard'));
  }, []);

  const value = {
    buyers, products, suppliers, buyerSales, retailSales, payments,
    buyersById, balances, balancesById, productRevenue, today, recent, activeProducts,
    loading, offline, toast, showToast, load,
    insertBuyer, updateBuyer, updateProduct, insertBuyerSale, insertPayment, insertRetailSale,
    filterByPeriod,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
