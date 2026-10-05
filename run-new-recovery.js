const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://yfxinmfkfttzuwgmmifl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeGlubWZrZnR0enV3Z21taWZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Mzc5NzAsImV4cCI6MjA4NzQxMzk3MH0.myukRHttFDaQLwW0pNOfXDYSmcmtsXbBTgFhaBY-j7s';

const PAGE_SIZE = 1000;
const ROOT_DIR = __dirname;
const NEW_RECOVERY_DIR = path.join(ROOT_DIR, 'new_recovery');
const EXISTING_EXPORT_DIR = path.join(ROOT_DIR, 'export');

const MASTER_DIR = path.join(NEW_RECOVERY_DIR, '01_master_data');
const SALES_DIR = path.join(NEW_RECOVERY_DIR, '02_sales');
const PAYMENTS_DIR = path.join(NEW_RECOVERY_DIR, '03_payments');
const PER_BUYER_DIR = path.join(NEW_RECOVERY_DIR, '04_per_buyer');
const REPORTS_DIR = path.join(NEW_RECOVERY_DIR, '05_reports');
const RAW_BACKUP_DIR = path.join(NEW_RECOVERY_DIR, '06_raw_backup');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) { rl.question(question, resolve); return; }
    if (!process.stdin.isTTY || process.env.SEED_NON_TTY) {
      rl.question(question, resolve);
      return;
    }
    const stdin = process.openStdin();
    process.stdout.write(question);
    let value = '';
    const onData = (char) => {
      char = char + '';
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function discoverTables() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = await res.json();
    const paths = Object.keys(spec.paths || {});
    const tables = paths
      .filter((p) => p.startsWith('/') && !p.startsWith('/rpc/') && p !== '/')
      .map((p) => p.slice(1))
      .filter(Boolean);
    return [...new Set(tables)].sort();
  } catch (err) {
    console.log(`  Schema discovery failed (${err.message}), using fallback list.`);
    return ['buyers', 'products', 'suppliers', 'retail_sales', 'buyer_sales', 'buyer_payments', 'payments'];
  }
}

async function fetchAll(supabase, table) {
  let all = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select('*').range(from, to);
    if (error) return { error };
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all };
}

function ensureDirs() {
  for (const d of [NEW_RECOVERY_DIR, MASTER_DIR, SALES_DIR, PAYMENTS_DIR, PER_BUYER_DIR, REPORTS_DIR, RAW_BACKUP_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeCsv(filePath, rows) {
  if (!rows.length) { fs.writeFileSync(filePath, ''); return; }
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','));
  fs.writeFileSync(filePath, lines.join('\n'));
}

function sortByField(arr, field, ascending = true) {
  return [...arr].sort((a, b) => {
    const va = a[field], vb = b[field];
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return ascending ? va - vb : vb - va;
    return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
}

function loadExistingJson(name) {
  const p = path.join(EXISTING_EXPORT_DIR, `${name}.json`);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  }
  return null;
}

async function fetchFromSupabase() {
  console.log('\n--- Option A: Live Supabase Export ---');
  let email, password;
  if (process.env.SEED_EMAIL && process.env.SEED_PASSWORD) {
    email = process.env.SEED_EMAIL;
    password = process.env.SEED_PASSWORD;
    console.log('[auto] Using credentials from SEED_EMAIL / SEED_PASSWORD env vars.');
  } else {
    email = await ask('Email: ');
    password = await ask('Password: ', true);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('\nSigning in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) { console.log(`❌ Sign-in failed: ${authError.message}`); return null; }
  console.log(`✅ Signed in as ${authData.user.email}`);

  console.log('\nDiscovering tables...');
  const tables = await discoverTables();
  console.log(`Tables: ${tables.join(', ')}`);

  const result = {};
  for (const table of tables) {
    process.stdout.write(`  Fetching "${table}"... `);
    const r = await fetchAll(supabase, table);
    if (r.error) { console.log(`skip (${r.error.message})`); continue; }
    result[table] = r.data;
    const flag = r.data.length % 1000 === 0 && r.data.length > 0 ? '  ⚠️ check if more exists' : '';
    console.log(`✅ ${r.data.length} rows${flag}`);
  }
  return result;
}

function useExistingExport() {
  console.log('\n--- Option B: Using existing export/ folder ---');
  const candidates = ['buyers', 'products', 'suppliers', 'retail_sales', 'buyer_sales', 'buyer_payments', 'payments'];
  const result = {};
  for (const c of candidates) {
    const data = loadExistingJson(c);
    if (data && Array.isArray(data) && data.length > 0) {
      result[c] = data;
      console.log(`  ✅ ${c}: ${data.length} rows (from existing export)`);
    }
  }
  return result;
}

function normalizePayments(data) {
  if (data.buyer_payments && data.buyer_payments.length) return data.buyer_payments;
  if (data.payments && data.payments.length) return data.payments;
  return [];
}

function organize(data) {
  console.log('\n--- Organizing data into new_recovery/ ---');
  ensureDirs();

  const buyers = data.buyers || [];
  const products = data.products || [];
  const suppliers = data.suppliers || [];
  const retailSales = data.retail_sales || [];
  const buyerSales = data.buyer_sales || [];
  const payments = normalizePayments(data);

  const buyersByName = sortByField(buyers, 'name');
  const productsByOrder = sortByField(products, 'sort_order');
  const suppliersByName = sortByField(suppliers, 'name');
  const retailByDate = sortByField(retailSales, 'sale_date');
  const buyerSalesByDate = sortByField(buyerSales, 'sale_date');
  const paymentsByDate = sortByField(payments, 'paid_at');

  // 01 MASTER DATA
  writeJson(path.join(MASTER_DIR, 'buyers_sorted.json'), buyersByName);
  writeJson(path.join(MASTER_DIR, 'products_sorted.json'), productsByOrder);
  writeJson(path.join(MASTER_DIR, 'suppliers_sorted.json'), suppliersByName);
  writeCsv(path.join(MASTER_DIR, 'buyers_sorted.csv'), buyersByName.map(b => ({
    id: b.id, name: b.name, phone: b.phone || '', address: b.address || '', created_at: b.created_at || ''
  })));
  writeCsv(path.join(MASTER_DIR, 'products_sorted.csv'), productsByOrder.map(p => ({
    id: p.id, name: p.name, emoji: p.emoji || '', active: p.active, sort_order: p.sort_order, created_at: p.created_at || ''
  })));
  writeCsv(path.join(MASTER_DIR, 'suppliers_sorted.csv'), suppliersByName.map(s => ({
    id: s.id, name: s.name, phone: s.phone || '', address: s.address || '', created_at: s.created_at || ''
  })));
  console.log('  ✅ 01_master_data/ written (JSON + CSV)');

  // 02 SALES
  writeJson(path.join(SALES_DIR, 'retail_sales_by_date.json'), retailByDate);
  writeJson(path.join(SALES_DIR, 'buyer_sales_by_date.json'), buyerSalesByDate);
  writeCsv(path.join(SALES_DIR, 'retail_sales_by_date.csv'), retailByDate.map(s => ({
    id: s.id, product: s.product || '', mootais_sold: s.mootais_sold ?? s.mootais ?? '',
    price_per_mootai: s.price_per_mootai ?? '', total: (s.mootais_sold ?? s.mootais ?? 0) * (s.price_per_mootai ?? 0),
    sale_date: s.sale_date || '', notes: s.notes || '', created_at: s.created_at || ''
  })));
  writeCsv(path.join(SALES_DIR, 'buyer_sales_by_date.csv'), buyerSalesByDate.map(s => ({
    id: s.id, buyer_id: s.buyer_id || '', product: s.product || '', mootais: s.mootais ?? s.mootais_sold ?? '',
    price_per_mootai: s.price_per_mootai ?? '', total: (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0),
    sale_date: s.sale_date || '', notes: s.notes || '', created_at: s.created_at || ''
  })));
  console.log('  ✅ 02_sales/ written (JSON + CSV)');

  // 03 PAYMENTS
  writeJson(path.join(PAYMENTS_DIR, 'buyer_payments_by_date.json'), paymentsByDate);
  writeCsv(path.join(PAYMENTS_DIR, 'buyer_payments_by_date.csv'), paymentsByDate.map(p => ({
    id: p.id, buyer_id: p.buyer_id || '', amount_paid: p.amount_paid ?? 0,
    paid_at: p.paid_at || '', notes: p.notes || '', created_at: p.created_at || ''
  })));
  console.log('  ✅ 03_payments/ written (JSON + CSV)');

  // 04 PER BUYER
  const buyerMap = {};
  for (const b of buyersByName) buyerMap[b.id] = b;
  const buyerSummary = [];

  for (const buyer of buyersByName) {
    const safeName = buyer.name.replace(/[^\w\u00C0-\u1FFF\s-]/g, '_').replace(/\s+/g, ' ').trim();
    const buyerDir = path.join(PER_BUYER_DIR, `${safeName}__${buyer.id.substring(0, 8)}`);
    if (!fs.existsSync(buyerDir)) fs.mkdirSync(buyerDir, { recursive: true });

    const bSales = buyerSalesByDate.filter(s => s.buyer_id === buyer.id);
    const bPayments = paymentsByDate.filter(p => p.buyer_id === buyer.id);
    const totalSales = bSales.reduce((sum, s) => sum + (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0), 0);
    const totalPaid = bPayments.reduce((sum, p) => sum + (p.amount_paid ?? 0), 0);
    const balance = totalSales - totalPaid;

    const timeline = [];
    for (const s of bSales) timeline.push({
      date: s.sale_date || '', type: 'SALE', product: s.product || '',
      mootais: s.mootais ?? s.mootais_sold ?? '', rate: s.price_per_mootai ?? '',
      amount: (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0), notes: s.notes || ''
    });
    for (const p of bPayments) timeline.push({
      date: p.paid_at || '', type: 'PAYMENT', product: '', mootais: '', rate: '',
      amount: -(p.amount_paid ?? 0), notes: p.notes || ''
    });
    const sortedTimeline = sortByField(timeline, 'date');

    writeJson(path.join(buyerDir, '01_info.json'), {
      id: buyer.id, name: buyer.name, phone: buyer.phone || '', address: buyer.address || '',
      total_sales: totalSales, total_paid: totalPaid, balance_due: balance,
      sales_count: bSales.length, payments_count: bPayments.length
    });
    writeJson(path.join(buyerDir, '02_sales.json'), bSales);
    writeJson(path.join(buyerDir, '03_payments.json'), bPayments);
    writeJson(path.join(buyerDir, '04_timeline.json'), sortedTimeline);
    writeCsv(path.join(buyerDir, '04_timeline.csv'), sortedTimeline);

    buyerSummary.push({
      buyer_id: buyer.id, name: buyer.name, phone: buyer.phone || '',
      total_sales: totalSales, total_paid: totalPaid, balance_due: balance,
      sales_count: bSales.length, payments_count: bPayments.length
    });
  }
  console.log(`  ✅ 04_per_buyer/ written (${buyersByName.length} buyer folders)`);

  // 05 REPORTS
  const buyerSummarySorted = sortByField(buyerSummary, 'balance_due', false);
  writeJson(path.join(REPORTS_DIR, 'buyer_ledger_summary.json'), buyerSummarySorted);
  writeCsv(path.join(REPORTS_DIR, 'buyer_ledger_summary.csv'), buyerSummarySorted);

  let grandSales = 0, grandRetail = 0, grandPaid = 0;
  for (const bs of buyerSalesByDate) grandSales += (bs.mootais ?? bs.mootais_sold ?? 0) * (bs.price_per_mootai ?? 0);
  for (const rs of retailByDate) grandRetail += (rs.mootais_sold ?? rs.mootais ?? 0) * (rs.price_per_mootai ?? 0);
  for (const p of paymentsByDate) grandPaid += (p.amount_paid ?? 0);

  const productAgg = {};
  for (const s of [...buyerSalesByDate, ...retailByDate]) {
    const pname = s.product || '(unknown)';
    if (!productAgg[pname]) productAgg[pname] = { product: pname, total_mootais: 0, total_revenue: 0, sales_count: 0 };
    const qty = s.mootais ?? s.mootais_sold ?? 0;
    const rate = s.price_per_mootai ?? 0;
    productAgg[pname].total_mootais += qty;
    productAgg[pname].total_revenue += qty * rate;
    productAgg[pname].sales_count += 1;
  }
  const productReport = sortByField(Object.values(productAgg), 'total_revenue', false);
  writeJson(path.join(REPORTS_DIR, 'product_sales_summary.json'), productReport);
  writeCsv(path.join(REPORTS_DIR, 'product_sales_summary.csv'), productReport);

  const overview = {
    generated_at: new Date().toISOString(),
    buyers: buyers.length,
    products: products.length,
    suppliers: suppliers.length,
    buyer_sales_count: buyerSalesByDate.length,
    retail_sales_count: retailByDate.length,
    payments_count: paymentsByDate.length,
    totals: {
      buyer_sales_total: grandSales,
      retail_sales_total: grandRetail,
      total_sales_revenue: grandSales + grandRetail,
      total_payments_received: grandPaid,
      outstanding_balance: grandSales - grandPaid
    }
  };
  writeJson(path.join(REPORTS_DIR, 'OVERVIEW.json'), overview);

  const readme = `# GSM Traders — Data Recovery Report

Generated: ${new Date().toLocaleString()}

## Structure

| Folder | Contents |
|---|---|
| 01_master_data/ | Buyers, products, suppliers — sorted JSON + CSV |
| 02_sales/ | All buyer sales & retail sales — sorted by date |
| 03_payments/ | All buyer payments — sorted by date |
| 04_per_buyer/ | One folder per buyer: info, sales, payments, timeline |
| 05_reports/ | Buyer ledger, product summary, OVERVIEW totals |
| 06_raw_backup/ | Exact raw JSON from Supabase + combined snapshot |

## Quick Totals

- Total buyers: ${buyers.length}
- Total products: ${products.length}
- Total suppliers: ${suppliers.length}
- Buyer sales count: ${buyerSalesByDate.length} entries, ₹${grandSales.toLocaleString()}
- Retail sales count: ${retailByDate.length} entries, ₹${grandRetail.toLocaleString()}
- **Combined sales revenue: ₹${(grandSales + grandRetail).toLocaleString()}**
- Total payments received: ₹${grandPaid.toLocaleString()}
- **Outstanding balance (buyer dues): ₹${(grandSales - grandPaid).toLocaleString()}**

## Top 5 Products by Revenue
${productReport.slice(0, 5).map((p, i) => `${i + 1}. ${p.product} — ${p.total_mootais} mootais, ₹${p.total_revenue.toLocaleString()}`).join('\n')}

## Buyers with Highest Balance Due
${buyerSummarySorted.slice(0, 5).filter(b => b.balance_due > 0).map((b, i) => `${i + 1}. ${b.name} (${b.phone || 'no phone'}) — ₹${b.balance_due.toLocaleString()}`).join('\n') || '  — (no outstanding balances)'}
`;
  fs.writeFileSync(path.join(REPORTS_DIR, 'REPORT_README.txt'), readme);
  console.log('  ✅ 05_reports/ written (overview, product summary, buyer ledger + readme)');

  // 06 RAW BACKUP
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const rawSnapshot = { exported_at: stamp, tables: data };
  writeJson(path.join(RAW_BACKUP_DIR, `raw_combined_${stamp}.json`), rawSnapshot);
  for (const [tableName, rows] of Object.entries(data)) {
    writeJson(path.join(RAW_BACKUP_DIR, `raw_${tableName}.json`), rows);
  }
  console.log(`  ✅ 06_raw_backup/ written (raw snapshots)`);

  return { overview, buyerSummarySorted, productReport };
}

async function main() {
  console.log('========================================');
  console.log('  GSM Traders — New Recovery Organizer');
  console.log('========================================');
  console.log('\nThis will extract ALL your website data and arrange it neatly into');
  console.log('the new_recovery/ folder with proper order, per-buyer reports, and summaries.');
  console.log('\nChoose data source:');
  console.log('  1 = Pull LIVE data from Supabase (requires email + password login)');
  console.log('  2 = Use the existing export/ folder files already on disk');

  let choice;
  if (process.env.SEED_CHOICE === '1' || process.env.SEED_CHOICE === '2') {
    choice = process.env.SEED_CHOICE;
    console.log(`\n[auto] Data source choice from SEED_CHOICE env var: ${choice}`);
  } else {
    choice = await ask('\nEnter 1 or 2 (default 2): ');
  }
  let data = null;

  if (choice.trim() === '1') {
    data = await fetchFromSupabase();
    if (!data) { console.log('\nFalling back to existing export folder...'); data = useExistingExport(); }
  } else {
    data = useExistingExport();
  }

  if (!data || Object.keys(data).length === 0) {
    console.log('\n❌ No data found. Either log in to Supabase (option 1) or ensure export/ folder has data.');
    rl.close();
    process.exit(1);
  }

  const result = organize(data);

  console.log('\n========================================');
  console.log('  ✅ DONE! Data organized in new_recovery/');
  console.log('========================================');
  console.log(`\nFolder: ${NEW_RECOVERY_DIR}`);
  console.log(`\nQuick totals:`);
  console.log(`  Buyers: ${result.overview.buyers}`);
  console.log(`  Products: ${result.overview.products}`);
  console.log(`  Combined sales revenue: ₹${result.overview.totals.total_sales_revenue.toLocaleString()}`);
  console.log(`  Payments received: ₹${result.overview.totals.total_payments_received.toLocaleString()}`);
  console.log(`  Outstanding dues: ₹${result.overview.totals.outstanding_balance.toLocaleString()}`);
  console.log(`\nOpen new_recovery/05_reports/REPORT_README.txt for full details.`);

  rl.close();
}

main().catch(e => { console.error('Unexpected error:', e); rl.close(); process.exit(1); });
