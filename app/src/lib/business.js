const INDIAN_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const CURRENCY_FMT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function currencyINR(n) {
  const v = n == null || Number.isNaN(Number(n)) ? 0 : Number(n);
  return CURRENCY_FMT.format(Math.round(v));
}

export function formatDateCompact(iso) {
  if (!iso) return '—';
  const d = parseDateStr(iso);
  if (!d || Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseDateStr(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const first = String(s).slice(0, 10);
  const [y, m, d] = first.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0);
}

export function toISTDateKey(date = new Date()) {
  const ist = new Date(date.getTime() + INDIAN_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function realTodayIST() {
  return toISTDateKey(new Date());
}

export function dataRefDate(...dateLists) {
  let latest = null;
  for (const list of dateLists) {
    for (const row of list || []) {
      for (const f of ['sale_date', 'paid_at', 'created_at']) {
        const key = row && row[f] ? String(row[f]).slice(0, 10) : null;
        if (key && key >= '2000-01-01' && (!latest || key > latest)) latest = key;
      }
    }
  }
  return latest || realTodayIST();
}

let dashboardRefToday = realTodayIST();
let reportsRefToday = realTodayIST();

export function setRefToday(value) {
  dashboardRefToday = value || realTodayIST();
  reportsRefToday = realTodayIST();
  return { dashboard: dashboardRefToday, reports: reportsRefToday };
}

export function todayIST(scope = 'reports') {
  if (scope === 'dashboard') return dashboardRefToday;
  return reportsRefToday;
}

export function startOfWeekIST(scope = 'reports') {
  const d = parseDateStr(todayIST(scope));
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return toISTDateKey(d);
}

export function startOfMonthIST(scope = 'reports') {
  const k = todayIST(scope);
  return k.slice(0, 7) + '-01';
}

export function startOfThreeMonthsAgo(scope = 'reports') {
  const d = parseDateStr(todayIST(scope));
  d.setMonth(d.getMonth() - 3);
  return toISTDateKey(d);
}

export function inPeriod(dateStr, period, scope = 'reports') {
  const key = dateStr ? String(dateStr).slice(0, 10) : null;
  if (!key) return false;
  if (period === 'all' || !period) return true;
  if (period === 'today') return key === todayIST(scope);
  if (period === 'week') return key >= startOfWeekIST(scope);
  if (period === 'month') return key >= startOfMonthIST(scope);
  if (period === '3months') return key >= startOfThreeMonthsAgo(scope);
  return true;
}

const AVATAR_PALETTE = [
  'bg-teal-500',
  'bg-[#0f3460]',
  'bg-indigo-600',
  'bg-red-600',
  'bg-purple-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-sky-700',
  'bg-pink-600',
  'bg-[#8200da]',
  'bg-green-700',
  'bg-blue-700',
];

export function stringHash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  const p0 = parts[0] || '';
  const p1 = parts[1] || '';
  return (p0[0] + (p1[0] || '')).toUpperCase();
}

export function getInitialsColor(name) {
  return AVATAR_PALETTE[stringHash(name) % AVATAR_PALETTE.length];
}

export function getProductEmoji(productName, products = []) {
  if (!productName) return '🌿';
  const match = products.find((p) => p.name === productName);
  if (match && match.emoji) return match.emoji;
  const map = {
    Malli: '🌼',
    Pudina: '🌿',
    Karuvepillai: '🍃',
    poondu: '🧄',
  };
  return map[productName] || '🌱';
}

export async function fetchAllPaginated(sb, table, { orderCol = 'created_at', orderAsc = false, limit = 1000 } = {}) {
  let all = [];
  let from = 0;
  while (true) {
    const to = from + limit - 1;
    let q = sb.from(table).select('*').range(from, to);
    if (orderCol) q = q.order(orderCol, { ascending: orderAsc });
    const { data, error } = await q;
    if (error) return { error, data: null };
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < limit) break;
    from += limit;
  }
  return { data: all, error: null };
}

export function computeBuyerBalances(buyers, buyerSales, buyerPayments) {
  const perBuyer = new Map();
  const out = {
    list: [],
    outstanding_total: 0,
    outstanding_count: 0,
    cleared_count: 0,
    total_sales: 0,
    total_payments: 0,
  };
  for (const b of buyers) {
    perBuyer.set(b.id, {
      id: b.id,
      name: b.name,
      phone: b.phone || '',
      address: b.address || '',
      buyer_obj: b,
      sales: [],
      payments: [],
      total_sales: 0,
      total_paid: 0,
      balance_due: 0,
      sales_count: 0,
      payments_count: 0,
      last_purchase: null,
      last_payment: null,
    });
  }
  for (const s of buyerSales || []) {
    const qty = s.mootais ?? s.mootais_sold ?? 0;
    const rate = s.price_per_mootai ?? 0;
    const amt = Number(qty || 0) * Number(rate || 0);
    const entry = perBuyer.get(s.buyer_id);
    if (entry) {
      entry.sales.push(s);
      entry.total_sales += amt;
      entry.sales_count += 1;
      if (!entry.last_purchase || (s.sale_date && s.sale_date > entry.last_purchase)) {
        entry.last_purchase = s.sale_date || null;
      }
    }
    out.total_sales += amt;
  }
  for (const p of buyerPayments || []) {
    const entry = perBuyer.get(p.buyer_id);
    const amt = Number(p.amount_paid ?? 0);
    if (entry) {
      entry.payments.push(p);
      entry.total_paid += amt;
      entry.payments_count += 1;
      if (!entry.last_payment || (p.paid_at && p.paid_at > entry.last_payment)) {
        entry.last_payment = p.paid_at || null;
      }
    }
    out.total_payments += amt;
  }
  for (const b of buyers) {
    const e = perBuyer.get(b.id);
    e.balance_due = Math.max(0, e.total_sales - e.total_paid);
    if (e.balance_due > 0) {
      out.outstanding_total += e.balance_due;
      out.outstanding_count += 1;
    } else {
      out.cleared_count += 1;
    }
    out.list.push(e);
  }
  out.list.sort((a, b) => b.balance_due - a.balance_due);
  return out;
}

export function computeProductRevenue(buyerSales, retailSales) {
  const agg = new Map();
  const bump = (productName, mootais, revenue) => {
    const k = productName || '(Unknown)';
    if (!agg.has(k)) agg.set(k, { product: k, total_mootais: 0, total_revenue: 0, sales_count: 0 });
    const e = agg.get(k);
    e.total_mootais += Number(mootais || 0);
    e.total_revenue += Number(revenue || 0);
    e.sales_count += 1;
  };
  for (const s of buyerSales || []) {
    const q = s.mootais ?? s.mootais_sold ?? 0;
    const r = s.price_per_mootai ?? 0;
    bump(s.product, q, q * r);
  }
  for (const s of retailSales || []) {
    const q = s.mootais_sold ?? s.mootais ?? 0;
    const r = s.price_per_mootai ?? 0;
    bump(s.product, q, q * r);
  }
  return Array.from(agg.values()).sort((a, b) => b.total_revenue - a.total_revenue);
}

export function todayFigures(buyerSales, retailSales, buyerPayments) {
  const today = todayIST('dashboard');
  let buyers = 0;
  let retail = 0;
  for (const s of buyerSales || []) if ((s.sale_date || '').slice(0, 10) === today) buyers += (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0);
  for (const s of retailSales || []) if ((s.sale_date || '').slice(0, 10) === today) retail += (s.mootais_sold ?? s.mootais ?? 0) * (s.price_per_mootai ?? 0);
  return { buyers, retail, total: buyers + retail };
}

export function buildRecentActivity(buyerSales, payments, buyersById = {}, limit = 8) {
  const rows = [];
  for (const s of buyerSales || []) {
    const buyer = buyersById[s.buyer_id];
    rows.push({
      ts: s.sale_date || s.created_at || '',
      type: 'SALE',
      id: s.id,
      product: s.product,
      buyer_name: buyer ? buyer.name : '',
      buyer_id: s.buyer_id,
      amount: (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0),
      date: s.sale_date || null,
    });
  }
  for (const p of payments || []) {
    const buyer = buyersById[p.buyer_id];
    rows.push({
      ts: p.paid_at || p.created_at || '',
      type: 'PAYMENT',
      id: p.id,
      product: null,
      buyer_name: buyer ? buyer.name : '',
      buyer_id: p.buyer_id,
      amount: Number(p.amount_paid ?? 0),
      date: p.paid_at || null,
    });
  }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return rows.slice(0, limit);
}

export function buildMonthlyBuckets(buyerSales, retailSales, period, scope = 'dashboard') {
  const buckets = new Map();
  const ensure = (key) => {
    if (!buckets.has(key)) buckets.set(key, { key, buyers: 0, retail: 0 });
    return buckets.get(key);
  };
  const each = (arr, field, prop) => {
    for (const s of arr || []) {
      const ds = (s[field] || '').slice(0, 10);
      if (!inPeriod(ds, period, scope)) continue;
      const d = parseDateStr(ds);
      if (!d) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const labelShort = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const b = ensure(`${y}-${m}||${labelShort}`);
      const amt = ((s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0)) || 0;
      b[prop] += amt;
    }
  };
  each(buyerSales, 'sale_date', 'buyers');
  each(retailSales, 'sale_date', 'retail');
  const list = Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  return list.map((x) => {
    const [, label] = x.key.split('||');
    return { label, buyers: Math.round(x.buyers), retail: Math.round(x.retail), total: Math.round(x.buyers + x.retail) };
  });
}
