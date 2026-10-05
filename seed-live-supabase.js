const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SUPABASE_URL = 'https://yfxinmfkfttzuwgmmifl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeGlubWZrZnR0enV3Z21taWZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Mzc5NzAsImV4cCI6MjA4NzQxMzk3MH0.myukRHttFDaQLwW0pNOfXDYSmcmtsXbBTgFhaBY-j7s';

const BACKUP_DIR = path.join(__dirname, 'new_recovery', '06_raw_backup');

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const isTty = process.stdin.isTTY && !process.env.SEED_NON_TTY;
    if (hidden && isTty) {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      let password = '';
      process.stdout.write(q);
      stdin.on('data', (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            stdin.setRawMode(false);
            rl.close();
            console.log();
            resolve(password);
            break;
          case '\u0003':
            stdin.setRawMode(false);
            rl.close();
            process.exit(0);
            break;
          default:
            if (char.charCodeAt(0) === 8) {
              if (password.length > 0) {
                password = password.slice(0, -1);
                process.stdout.write('\b \b');
              }
            } else {
              password += char;
              process.stdout.write('*');
            }
        }
      });
    } else {
      rl.question(q, (a) => { rl.close(); resolve(a); });
    }
  });
}

function loadJson(name) {
  const p = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`Missing backup file: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function chunkedUpsert(supabase, table, rows, chunkSize = 500) {
  let inserted = 0, updated = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      console.error(`    ❌ chunk ${Math.floor(i / chunkSize) + 1} ERROR on "${table}":`, error.message);
      console.error('    First row sample:', JSON.stringify(chunk[0]).slice(0, 200));
      throw error;
    }
    inserted += chunk.length;
    updated += chunk.length;
    process.stdout.write(`    chunk ${Math.floor(i / chunkSize) + 1} (${i + 1}-${Math.min(i + chunkSize, rows.length)})... OK\n`);
  }
  return { inserted, updated };
}

(async () => {
  console.log('================================================================');
  console.log('GSM Traders — Seed Live Supabase with Recovered Data');
  console.log('================================================================\n');

  console.log('Loading local backup files from new_recovery/06_raw_backup/ ...');
  const buyers = loadJson('raw_buyers.json');
  const products = loadJson('raw_products.json');
  const suppliers = loadJson('raw_suppliers.json');
  const buyerSales = loadJson('raw_buyer_sales.json');
  const retailSales = loadJson('raw_retail_sales.json');
  const buyerPayments = loadJson('raw_buyer_payments.json');

  console.log(`  buyers:          ${String(buyers.length).padStart(5)} rows`);
  console.log(`  products:        ${String(products.length).padStart(5)} rows`);
  console.log(`  suppliers:       ${String(suppliers.length).padStart(5)} rows`);
  console.log(`  buyer_sales:     ${String(buyerSales.length).padStart(5)} rows`);
  console.log(`  retail_sales:    ${String(retailSales.length).padStart(5)} rows`);
  console.log(`  buyer_payments:  ${String(buyerPayments.length).padStart(5)} rows`);
  console.log(`  TOTAL:           ${String(buyers.length + products.length + suppliers.length + buyerSales.length + retailSales.length + buyerPayments.length).padStart(5)} rows\n`);

  console.log('Note: Upsert by primary key (id) — running twice is safe, no duplicates.');
  console.log('Order: master (buyers, products, suppliers) → transactions (sales, payments)\n');

  const envEmail = process.env.SEED_EMAIL;
  const envPass = process.env.SEED_PASSWORD;
  let finalEmail, password;
  if (envEmail && envPass) {
    finalEmail = envEmail.trim();
    password = envPass;
    console.log(`[auto] Using credentials from SEED_EMAIL / SEED_PASSWORD env vars.`);
  } else {
    const email = await ask('Owner email [gsmtraderscbe@gmail.com]: ');
    finalEmail = email.trim() || 'gsmtraderscbe@gmail.com';
    password = await ask('Password: ', true);
    if (!password) { console.log('❌ Password required.'); process.exit(1); }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  process.stdout.write(`\nSigning in as ${finalEmail}... `);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: finalEmail, password });
  if (authError) { console.log(`❌ ${authError.message}`); process.exit(1); }
  console.log(`✅ signed in (uid ${authData.user.id.substring(0, 8)}...)\n`);

  const plan = [
    { table: 'buyers', rows: buyers, label: 'Buyers (master)' },
    { table: 'products', rows: products, label: 'Products (master)' },
    { table: 'suppliers', rows: suppliers, label: 'Suppliers (master)' },
    { table: 'buyer_sales', rows: buyerSales, label: 'Buyer Sales (transactions)' },
    { table: 'retail_sales', rows: retailSales, label: 'Retail Sales (transactions)' },
    { table: 'buyer_payments', rows: buyerPayments, label: 'Buyer Payments (transactions)' },
  ];

  const summary = {};
  for (const step of plan) {
    console.log(`▶ ${step.label} → table "${step.table}" (${step.rows.length} rows)`);
    const t0 = Date.now();
    const r = await chunkedUpsert(supabase, step.table, step.rows);
    summary[step.table] = { count: step.rows.length, ms: Date.now() - t0 };
    console.log(`  ✅ done — ${step.rows.length} rows upserted (${summary[step.table].ms}ms)\n`);
  }

  console.log('================================================================');
  console.log('✅ SEED COMPLETE — All data uploaded to live Supabase.');
  console.log('================================================================\n');
  console.log('Per-table results:');
  let grand = 0;
  for (const k of Object.keys(summary)) {
    console.log(`  ${k.padEnd(15)} ${String(summary[k].count).padStart(5)} rows  (${summary[k].ms}ms)`);
    grand += summary[k].count;
  }
  console.log(`  ${"-".repeat(35)}`);
  console.log(`  ${"TOTAL".padEnd(15)} ${String(grand).padStart(5)} rows\n`);
  console.log('Next step: run `node run-new-recovery.js` → choose 1 (Pull LIVE from Supabase)');
  console.log('          to verify the live DB row counts match.\n');

  await supabase.auth.signOut().catch(() => {});
  process.exit(0);
})();
