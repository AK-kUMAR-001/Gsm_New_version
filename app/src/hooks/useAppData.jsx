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
  realTodayIST,
} from '../lib/business.js';

const AppDataContext = createContext(null);

const OFFLINE = {
  buyers: [],
  products: [],
  suppliers: [],
  buyerSales: [],
  retailSales: [],
  payments: [],
};

const isMissingTableError = (error) => error?.code === 'PGRST205' || error?.code === '42P01';

async function safeFetch(table) {
  try {
    const res = await fetchAllPaginated(supabase, table);
    if (res.error) return { data: null, error: res.error };
    return { data: res.data || [], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

async function fetchPayments() {
  try {
    const primary = await fetchAllPaginated(supabase, 'buyer_payments');
    if (!primary.error) {
      if (primary.data?.length) return { data: primary.data, error: null };
      const legacy = await fetchAllPaginated(supabase, 'payments');
      if (legacy.error && !isMissingTableError(legacy.error)) return { data: null, error: legacy.error };
      return { data: legacy.data?.length ? legacy.data : (primary.data || []), error: null };
    }
    if (!isMissingTableError(primary.error)) return { data: null, error: primary.error };

    const legacy = await fetchAllPaginated(supabase, 'payments');
    if (legacy.error) return { data: null, error: legacy.error };
    return { data: legacy.data || [], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export function AppDataProvider({ children }) {
  const auth = useAuth();
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [buyerSales, setBuyerSales] = useState([]);
  const [retailSales, setRetailSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [inventorySettings, setInventorySettings] = useState([]);
  const [inventorySummary, setInventorySummary] = useState([]);
  const [inventoryCounts, setInventoryCounts] = useState([]);
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [dataLoadError, setDataLoadError] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToast({ id, message, kind });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 3200);
  }, []);

  const load = useCallback(async () => {
    let b, p, s, bs, rs, pay;
    let loadError = null;
    setLoading(true);
    const results = await Promise.all([
      safeFetch('buyers'),
      safeFetch('products'),
      safeFetch('suppliers'),
      safeFetch('buyer_sales'),
      safeFetch('retail_sales'),
      fetchPayments(),
    ]);
    const failed = results.find((result) => result.error);
    if (failed) {
      [b, p, s, bs, rs, pay] = [
        OFFLINE.buyers,
        OFFLINE.products,
        OFFLINE.suppliers,
        OFFLINE.buyerSales,
        OFFLINE.retailSales,
        OFFLINE.payments,
      ];
      setDataLoadError(`Live data could not be loaded: ${failed.error.message || 'Database request failed.'}`);
      setOffline(true);
      loadError = failed.error;
    } else {
      [b, p, s, bs, rs, pay] = results.map((result) => result.data);
      setDataLoadError('');
      setOffline(false);
    }
    setRefToday(realTodayIST());
    setBuyers(b);
    setProducts(p);
    setSuppliers(s);
    setBuyerSales(bs);
    setRetailSales(rs);
    setPayments(pay);
    setLoading(false);
    return loadError ? { error: loadError } : { data: true };
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.isAuthed) {
      setBuyers([]);
      setProducts([]);
      setSuppliers([]);
      setBuyerSales([]);
      setRetailSales([]);
      setPayments([]);
      setOffline(false);
      setDataLoadError('');
      setLoading(false);
      return;
    }
    load();
  }, [auth.loading, auth.isAuthed, load]);

  const loadInventory = useCallback(async () => {
    if (offline) {
      setInventorySettings([]);
      setInventorySummary([]);
      setInventoryCounts([]);
      setInventoryMovements([]);
      setInventoryError('Stock tracking requires the live database and the v0.2 inventory migration.');
      return { error: new Error('offline') };
    }

    setInventoryLoading(true);
    setInventoryError('');
    const [settings, summary, counts, movements] = await Promise.all([
      supabase.from('inventory_product_settings').select('product_id, enabled_at, low_stock_threshold'),
      supabase.from('inventory_stock_summary').select('product_id, quantity_on_hand, inventory_value, average_unit_cost, enabled_at'),
      fetchAllPaginated(supabase, 'inventory_daily_counts', {
        columns: 'product_id, stock_date, counted_quantity, expected_quantity, variance_quantity, recorded_by, created_at',
        orderCol: 'stock_date',
        orderAsc: true,
      }),
      fetchAllPaginated(supabase, 'inventory_stock_movements', {
        columns: 'id, product_id, movement_type, quantity_delta, cost_delta, movement_date, supplier_id, source_kind, source_id, reason, created_at',
        orderCol: 'created_at',
      }),
    ]);
    const failed = [settings, summary, counts].find((result) => result.error) || (movements.error ? movements : null);
    if (failed) {
      setInventoryLoading(false);
      setInventoryError(`Could not load stock data: ${failed.error.message}`);
      return { error: failed.error };
    }

    setInventorySettings(settings.data || []);
    setInventorySummary(summary.data || []);
    setInventoryCounts(counts.data || []);
    setInventoryMovements(movements.data || []);
    setInventoryLoading(false);
    return { data: true };
  }, [offline]);

  const updateInventoryLowStockThreshold = async (productId, threshold) => {
    if (offline) {
      const error = new Error('Low-stock settings require the live database.');
      showToast(error.message, 'warn');
      return { error };
    }
    const value = Number(threshold);
    if (!Number.isFinite(value) || value < 0) {
      const error = new Error('Enter a valid low-stock threshold of zero or more.');
      showToast(error.message, 'error');
      return { error };
    }
    const { data, error } = await supabase
      .from('inventory_product_settings')
      .update({ low_stock_threshold: value })
      .eq('product_id', productId)
      .select('product_id, enabled_at, low_stock_threshold');
    if (error) {
      showToast(`Could not save low-stock threshold: ${error.message}`, 'error');
      return { error };
    }
    if (!data?.[0]) {
      const missingRowError = new Error('No tracked product was updated. Apply the low-stock settings migration and try again.');
      showToast(missingRowError.message, 'error');
      return { error: missingRowError };
    }
    setInventorySettings((previous) => previous.map((setting) => (
      setting.product_id === productId ? { ...setting, ...data[0] } : setting
    )));
    showToast('Low-stock warning saved', 'success');
    return { data: data[0] };
  };

  const refreshInventoryAfterSale = async () => {
    if (offline) return;
    const result = await loadInventory();
    if (result.error) showToast('Sale was saved, but the stock balance could not refresh.', 'warn');
  };

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
      showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn');
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
    if (offline) { showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('buyers').update(patch).eq('id', id).select();
    if (error) { showToast('Could not update buyer: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setBuyers((prev) => prev.map((b) => (b.id === id ? { ...b, ...data[0] } : b)));
    showToast('Buyer updated', 'success');
    return { data: data?.[0] };
  };

  const deleteBuyer = async (id) => {
    if (offline) {
      const error = new Error('Buyer deletion requires the live database.');
      showToast(error.message, 'warn');
      return { error };
    }

    const finishBuyerDeletion = async () => {
      setBuyers((prev) => prev.filter((buyer) => buyer.id !== id));
      setBuyerSales((prev) => prev.filter((sale) => sale.buyer_id !== id));
      setPayments((prev) => prev.filter((payment) => payment.buyer_id !== id));
      showToast('Buyer, sales, and payments deleted', 'success');
      const inventoryRefresh = await loadInventory();
      if (inventoryRefresh.error) {
        showToast('Buyer data was deleted, but stock could not refresh. Refresh Inventory to check its balance.', 'warn');
      }
      return { data: true };
    };

    const { error: rpcError } = await supabase.rpc('delete_buyer_and_all_data', {
      p_buyer_id: id,
    });
    if (!rpcError) return finishBuyerDeletion();

    const missingDeleteFunction = rpcError.code === 'PGRST202'
      || rpcError.message?.includes('delete_buyer_and_all_data')
      || rpcError.message?.includes('schema cache');
    if (!missingDeleteFunction) {
      showToast('Could not delete buyer: ' + rpcError.message, 'error');
      return { error: rpcError };
    }

    let salesDeleted = false;
    let paymentsDeleted = false;
    const refreshAfterPartialDelete = async (stage, error) => {
      if (salesDeleted || paymentsDeleted) {
        const refreshed = await load();
        const detail = refreshed.error
          ? ' Local data could not refresh; reload the app to check saved records.'
          : ' Some linked records may already be deleted; the buyer profile was not confirmed deleted.';
        const partialError = new Error(`Could not finish deleting this buyer while deleting ${stage}: ${error.message}.${detail}`);
        showToast(partialError.message, 'error');
        return { error: partialError, partial: true };
      }
      showToast(`Could not delete buyer: ${error.message}`, 'error');
      return { error };
    };

    const { error: salesError } = await supabase
      .from('buyer_sales')
      .delete()
      .eq('buyer_id', id);
    if (salesError) return refreshAfterPartialDelete('sales', salesError);
    salesDeleted = true;

    for (const table of ['buyer_payments', 'payments']) {
      const { error } = await supabase.from(table).delete().eq('buyer_id', id);
      if (!error) {
        paymentsDeleted = true;
        continue;
      }
      const missingTable = error.code === 'PGRST205' || error.code === '42P01';
      if (missingTable) continue;
      return refreshAfterPartialDelete('payments', error);
    }

    const { data, error: buyerError } = await supabase
      .from('buyers')
      .delete()
      .eq('id', id)
      .select('id');
    if (buyerError) return refreshAfterPartialDelete('buyer record', buyerError);
    if (!data?.length) {
      return refreshAfterPartialDelete('buyer record', new Error('No buyer row was deleted. Check database delete permissions.'));
    }

    return finishBuyerDeletion();
  };

  const updateProduct = async (id, patch) => {
    if (offline) { showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.from('products').update(patch).eq('id', id).select();
    if (error) { showToast('Could not update product: ' + error.message, 'error'); return { error }; }
    if (data?.[0]) setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...data[0] } : p)));
    showToast('Product saved', 'success');
    return { data: data?.[0] };
  };

  const insertProduct = async (input) => {
    if (offline) {
      const error = new Error('Product creation requires the live database.');
      showToast(error.message, 'warn');
      return { error };
    }
    const payload = {
      name: input.name.trim(),
      emoji: input.emoji,
      sort_order: Number(input.sort_order),
      active: input.active,
    };
    const { data, error } = await supabase.from('products').insert([payload]).select();
    if (error) {
      showToast('Could not add product: ' + error.message, 'error');
      return { error };
    }
    if (!data?.[0]) {
      const missingRowError = new Error('The database did not return the new product.');
      showToast(missingRowError.message, 'error');
      return { error: missingRowError };
    }
    setProducts((prev) => [...prev, data[0]]);
    showToast('Product added', 'success');
    return { data: data[0] };
  };

  const deleteProduct = async (id) => {
    if (offline) {
      const error = new Error('Product deletion requires the live database.');
      showToast(error.message, 'warn');
      return { error };
    }
    const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
    if (error) {
      showToast('Could not delete product: ' + error.message, 'error');
      return { error };
    }
    if (!data?.length) {
      const missingRowError = new Error('No product was deleted. Check database delete permissions.');
      showToast(missingRowError.message, 'error');
      return { error: missingRowError };
    }
    setProducts((prev) => prev.filter((product) => product.id !== id));
    showToast('Product deleted', 'success');
    return { data: true };
  };

  const insertBuyerSale = async (row) => {
    if (offline) { showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn'); return { error: new Error('offline') }; }
    const rpcResult = await supabase.rpc('inventory_record_buyer_sale', {
      p_id: row.id,
      p_buyer_id: row.buyer_id,
      p_product: row.product,
      p_mootais: row.mootais,
      p_price_per_mootai: row.price_per_mootai,
      p_sale_date: row.sale_date,
      p_notes: row.notes,
    });
    const { data, error } = rpcResult;
    if (error) { showToast('Could not save sale: ' + error.message, 'error'); return { error }; }
    if (data) {
      setBuyerSales((prev) => [data, ...prev.filter((sale) => sale.id !== data.id)]);
      await refreshInventoryAfterSale();
    }
    showToast('Sale recorded', 'success');
    return { data };
  };

  const insertPayment = async (row) => {
    if (offline) { showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn'); return { error: new Error('offline') }; }
    const tables = ['buyer_payments', 'payments'];
    for (const [index, tbl] of tables.entries()) {
      try {
        const { data, error } = await supabase.from(tbl).insert([row]).select();
        if (error) {
          const missingTable = error.code === 'PGRST205' || error.code === '42P01';
          if (index === 0 && missingTable) continue;
          showToast('Could not save payment: ' + error.message, 'error');
          return { error };
        }
        if (data?.[0]) setPayments((prev) => [data[0], ...prev]);
        showToast('Payment recorded', 'success');
        return { data: data?.[0] };
      } catch (error) {
        showToast(`Could not save payment: ${error.message || 'Unexpected database error.'}`, 'error');
        return { error };
      }
    }
    const error = new Error('Could not save payment: neither supported payment table is available.');
    showToast(error.message, 'error');
    return { error };
  };

  const insertRetailSale = async (row, { showSuccessToast = true } = {}) => {
    if (offline) { showToast('Offline mode — edits are disabled until the database connection is restored.', 'warn'); return { error: new Error('offline') }; }
    const { data, error } = await supabase.rpc('inventory_record_retail_sale', {
      p_id: row.id,
      p_product: row.product,
      p_mootais_sold: row.mootais_sold,
      p_price_per_mootai: row.price_per_mootai,
      p_sale_date: row.sale_date,
      p_notes: row.notes,
    });
    if (error) { showToast('Could not save retail sale: ' + error.message, 'error'); return { error }; }
    if (data) {
      setRetailSales((prev) => [data, ...prev.filter((sale) => sale.id !== data.id)]);
      await refreshInventoryAfterSale();
    }
    if (showSuccessToast) showToast('Retail sale recorded', 'success');
    return { data };
  };

  const recordInventoryAction = async (rpcName, args, successMessage) => {
    if (offline) {
      const error = new Error('Stock changes require an authenticated live database.');
      showToast(error.message, 'warn');
      return { error };
    }
    const { data, error } = await supabase.rpc(rpcName, args);
    if (error) {
      showToast(`Could not save stock change: ${error.message}`, 'error');
      return { error };
    }
    const refresh = await loadInventory();
    if (refresh.error) showToast('Stock change saved, but the stock view could not refresh.', 'warn');
    else showToast(successMessage, 'success');
    return { data, refreshError: refresh.error };
  };

  const startInventoryTracking = (
    productId, quantity, estimatedUnitCost, damagedQuantity, damageReason, damageRequestId,
  ) =>
    recordInventoryAction('inventory_start_tracking_with_count', {
      p_product_id: productId,
      p_opening_quantity: quantity,
      p_estimated_unit_cost: estimatedUnitCost,
      p_damaged_quantity: damagedQuantity,
      p_damage_reason: damageReason,
      p_damage_request_id: damageRequestId,
    }, 'Opening stock and today’s physical count recorded');

  const recordMorningCount = (productId, quantity, surplusUnitCost) =>
    recordInventoryAction('inventory_record_morning_count', {
      p_product_id: productId,
      p_counted_quantity: quantity,
      p_surplus_unit_cost: surplusUnitCost,
    }, 'Morning stock count recorded');

  const recordStockReceipt = (
    productId, supplierId, quantity, unitCost, notes, requestId, damagedQuantity, damageReason, damageRequestId,
  ) =>
    recordInventoryAction('inventory_record_receipt_with_damage', {
      p_product_id: productId,
      p_supplier_id: supplierId,
      p_quantity: quantity,
      p_unit_cost: unitCost,
      p_notes: notes,
      p_request_id: requestId,
      p_damaged_quantity: damagedQuantity,
      p_damage_reason: damageReason,
      p_damage_request_id: damageRequestId,
    }, damagedQuantity > 0 ? 'Stock receipt and arrival damage recorded' : 'Extra stock receipt recorded');

  const recordStockAdjustment = (productId, movementType, quantityDelta, reason, unitCost, requestId) =>
    recordInventoryAction('inventory_record_adjustment', {
      p_product_id: productId,
      p_movement_type: movementType,
      p_quantity_delta: quantityDelta,
      p_reason: reason,
      p_unit_cost: unitCost,
      p_request_id: requestId,
    }, movementType === 'spoilage' ? 'Damaged stock recorded' : 'Stock correction recorded');

  const filterByPeriod = useCallback((rows, period, dateField) => {
    if (period === 'all' || !period) return rows;
    return (rows || []).filter((r) => inPeriod(r[dateField], period, 'dashboard'));
  }, []);

  const value = {
    buyers, products, suppliers, buyerSales, retailSales, payments,
    inventorySettings, inventorySummary, inventoryCounts, inventoryMovements,
    buyersById, balances, balancesById, productRevenue, today, recent, activeProducts,
    loading, offline, dataLoadError, toast, showToast, load,
    inventoryLoading, inventoryError, loadInventory, updateInventoryLowStockThreshold,
    insertBuyer, updateBuyer, deleteBuyer, updateProduct, insertProduct, deleteProduct, insertBuyerSale, insertPayment, insertRetailSale,
    startInventoryTracking, recordMorningCount, recordStockReceipt, recordStockAdjustment,
    filterByPeriod,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
