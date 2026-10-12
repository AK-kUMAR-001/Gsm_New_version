import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(appDirectory, '.env.local');
const originalProjectRef = 'yfxinmfkfttzuwgmmifl';
const tables = ['buyers', 'products', 'suppliers', 'buyer_sales', 'retail_sales', 'buyer_payments'];
const masterTables = new Set(['buyers', 'products', 'suppliers']);
const transactionTables = new Set(['buyer_sales', 'retail_sales', 'buyer_payments']);
const chunkSize = 500;

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function loadConfiguration() {
  const values = parseEnv(await readFile(envFile, 'utf8'));
  const url = values.VITE_SUPABASE_URL;
  const anonKey = values.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Add the new project URL and anon key to app/.env.local first.');
  }

  let projectUrl;
  try {
    projectUrl = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL in app/.env.local is not a valid URL.');
  }
  const projectRef = projectUrl.hostname.split('.')[0];
  if (projectUrl.protocol !== 'https:' || projectRef === originalProjectRef) {
    throw new Error('Refusing to sync: the destination must be the new HTTPS Supabase project, not the original project.');
  }
  return { url, anonKey, projectRef };
}

function canonicalRow(row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])));
}

function validateBackup(backup) {
  if (backup?.format !== 'gsm-traders-backup' || backup.version !== 1 || !backup.data) {
    throw new Error('The file must be a GSM Traders backup JSON, version 1.');
  }

  const records = new Map();
  for (const table of tables) {
    const rows = backup.data[table];
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`The backup has no valid ${table} array.`);
    }
    if (rows.some((row) => typeof row.id !== 'string' || !row.id) || new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error(`${table} contains a missing or duplicate record ID.`);
    }
    records.set(table, rows);
  }

  const buyerIds = new Set(records.get('buyers').map((buyer) => buyer.id));
  for (const table of ['buyer_sales', 'buyer_payments']) {
    if (records.get(table).some((row) => !buyerIds.has(row.buyer_id))) {
      throw new Error(`${table} contains a reference to a buyer missing from the live backup.`);
    }
  }
  return records;
}

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function askPassword() {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this sync from an interactive terminal so the password can be entered without echoing.');
  }

  return new Promise((resolve, reject) => {
    let password = '';
    stdout.write('New project owner password (input hidden): ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', function onData(chunk) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdout.write('\n');
          reject(new Error('Sync cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdout.write('\n');
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
          continue;
        }
        password += character;
      }
    });
  });
}

async function readTable(client, table) {
  const rows = [];
  for (let offset = 0; ; offset += chunkSize) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .order('id')
      .range(offset, offset + chunkSize - 1);
    if (error) throw new Error(`Cannot read destination ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < chunkSize) return rows;
  }
}

function buildPlan(liveRecords, targetRecords) {
  const plan = new Map();
  for (const table of tables) {
    const targetById = new Map(targetRecords.get(table).map((row) => [row.id, row]));
    const additions = [];
    let updates = 0;
    let transactionConflicts = 0;
    for (const row of liveRecords.get(table)) {
      const existing = targetById.get(row.id);
      if (!existing) additions.push(row);
      else if (canonicalRow(existing) !== canonicalRow(row)) {
        if (transactionTables.has(table)) transactionConflicts += 1;
        else updates += 1;
      }
    }
    const liveIds = new Set(liveRecords.get(table).map((row) => row.id));
    const retained = targetRecords.get(table).filter((row) => !liveIds.has(row.id)).length;
    plan.set(table, { additions, updates, retained, transactionConflicts });
  }
  return plan;
}

function indiaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sumForDate(rows, dateField, amountForRow, date) {
  return rows
    .filter((row) => String(row[dateField] || '').slice(0, 10) === date)
    .reduce((sum, row) => sum + amountForRow(row), 0);
}

async function writeTable(client, table, rows, upsert) {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const batch = rows.slice(offset, offset + chunkSize);
    const query = upsert
      ? client.from(table).upsert(batch, { onConflict: 'id' })
      : client.from(table).insert(batch);
    const { error } = await query;
    if (error) {
      throw new Error(`Sync stopped while writing ${table}, rows ${offset + 1}-${offset + batch.length}: ${error.message}. The sync can be rerun safely.`);
    }
  }
}

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath) throw new Error('Pass the live backup JSON path: npm run sync:live-backup -- "C:\\path\\to\\backup.json".');

  const [configuration, backupText] = await Promise.all([
    loadConfiguration(),
    readFile(path.resolve(backupPath), 'utf8'),
  ]);
  const backup = JSON.parse(backupText);
  const liveRecords = validateBackup(backup);
  const client = createClient(configuration.url, configuration.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('Live-data merge preview');
  console.log(`Destination Supabase project: ${configuration.projectRef}`);
  console.log(`Source backup exported: ${backup.exportedAt || 'timestamp unavailable'}`);
  console.log('No records or credentials will be printed.');

  const email = await ask('New project owner login email: ');
  const password = await askPassword();
  if (!email || !password) throw new Error('A destination owner email and password are required.');
  const { error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Destination owner sign-in failed: ${authError.message}`);

  const targetRows = new Map();
  for (const table of tables) targetRows.set(table, await readTable(client, table));
  const plan = buildPlan(liveRecords, targetRows);

  console.log('\nTable             Live  Clone  Add  Update  Keep clone-only');
  for (const table of tables) {
    const item = plan.get(table);
    const conflicts = item.transactionConflicts ? `  CONFLICT ${item.transactionConflicts}` : '';
    console.log(`${table.padEnd(17)} ${String(liveRecords.get(table).length).padStart(4)}  ${String(targetRows.get(table).length).padStart(5)}  ${String(item.additions.length).padStart(3)}  ${String(item.updates).padStart(6)}  ${String(item.retained).padStart(15)}${conflicts}`);
  }

  const transactionConflictCount = [...plan.values()].reduce((sum, item) => sum + item.transactionConflicts, 0);
  if (transactionConflictCount) {
    throw new Error('A live transaction has different values under an existing ID in the clone. No data was written; reconcile those transactions manually.');
  }

  const { data: inventorySettings, error: inventoryError } = await client
    .from('inventory_product_settings')
    .select('product_id');
  if (inventoryError) {
    throw new Error(`Cannot verify stock-tracking status: ${inventoryError.message}. No data was written.`);
  }
  const targetProducts = new Map(targetRows.get('products').map((product) => [product.id, product]));
  const liveProducts = new Map(liveRecords.get('products').map((product) => [product.id, product]));
  const trackedNames = new Set();
  for (const setting of inventorySettings) {
    for (const product of [targetProducts.get(setting.product_id), liveProducts.get(setting.product_id)]) {
      if (product?.name) trackedNames.add(product.name);
    }
    const before = targetProducts.get(setting.product_id);
    const after = liveProducts.get(setting.product_id);
    if (before && after && before.name !== after.name) {
      throw new Error('A stock-tracked product name differs from the live backup. No data was written; reconcile its inventory history first.');
    }
  }
  const trackedNewSales = ['buyer_sales', 'retail_sales']
    .flatMap((table) => plan.get(table).additions)
    .filter((sale) => trackedNames.has(sale.product)).length;
  if (trackedNewSales) {
    throw new Error(`${trackedNewSales} new live sale(s) belong to a stock-tracked product. No data was written; reconcile those sales with the stock ledger first.`);
  }

  const hasChanges = [...plan.values()].some(({ additions, updates }) => additions.length > 0 || updates > 0);
  if (!hasChanges) {
    console.log('\nThe clone already contains all live rows; no sync is needed.');
    await client.auth.signOut();
    return;
  }
  if (await ask('\nType SYNC to apply this non-deleting merge to the new project: ') !== 'SYNC') {
    throw new Error('Sync cancelled; no records were written.');
  }

  const destinationBackup = Object.fromEntries([...targetRows].map(([table, rows]) => [table, rows]));
  const backupDirectory = path.join(homedir(), '.gsm-traders-backups');
  await mkdir(backupDirectory, { recursive: true });
  const backupStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destinationBackupPath = path.join(backupDirectory, `before-live-sync-${backupStamp}.json`);
  await writeFile(destinationBackupPath, JSON.stringify({
    format: 'gsm-traders-destination-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    projectRef: configuration.projectRef,
    data: destinationBackup,
  }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`Private destination backup created: ${destinationBackupPath}`);

  for (const table of tables) {
    const { additions, updates } = plan.get(table);
    if (masterTables.has(table)) {
      await writeTable(client, table, liveRecords.get(table), true);
    } else {
      await writeTable(client, table, additions, false);
    }
    console.log(`Synced ${table}: ${additions.length} added, ${updates} updated.`);
  }

  const finalRows = new Map();
  for (const table of tables) finalRows.set(table, await readTable(client, table));
  for (const table of tables) {
    const expectedCount = new Set([
      ...targetRows.get(table).map((row) => row.id),
      ...liveRecords.get(table).map((row) => row.id),
    ]).size;
    if (finalRows.get(table).length !== expectedCount) {
      throw new Error(`Post-sync verification failed for ${table}: expected ${expectedCount} rows, found ${finalRows.get(table).length}.`);
    }
  }

  const today = indiaToday();
  const buyerToday = sumForDate(finalRows.get('buyer_sales'), 'sale_date', (row) => Number(row.mootais) * Number(row.price_per_mootai), today);
  const retailToday = sumForDate(finalRows.get('retail_sales'), 'sale_date', (row) => Number(row.mootais_sold) * Number(row.price_per_mootai), today);
  const paymentsToday = sumForDate(finalRows.get('buyer_payments'), 'paid_at', (row) => Number(row.amount_paid), today);
  console.log('\nPost-sync row counts verified.');
  console.log(`Today in India (${today}): buyer sales ${buyerToday.toFixed(2)}, retail sales ${retailToday.toFixed(2)}, payments ${paymentsToday.toFixed(2)}.`);
  console.log('Clone-only records were retained; no rows were deleted.');
  const { error: signOutError } = await client.auth.signOut();
  if (signOutError) throw new Error(`Sync succeeded, but sign-out failed: ${signOutError.message}`);
}

main().catch((error) => {
  console.error(`\nLive-data sync failed: ${error.message}`);
  process.exitCode = 1;
});
