import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(appDirectory, 'src', 'data');
const envFile = path.join(appDirectory, '.env.local');
const originalProjectRef = 'yfxinmfkfttzuwgmmifl';
const datasets = [
  ['buyers', 'raw_buyers.json'],
  ['products', 'raw_products.json'],
  ['suppliers', 'raw_suppliers.json'],
  ['buyer_sales', 'raw_buyer_sales.json'],
  ['retail_sales', 'raw_retail_sales.json'],
  ['buyer_payments', 'raw_buyer_payments.json'],
];
const chunkSize = 500;

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function loadConfiguration() {
  const values = parseEnv(await readFile(envFile, 'utf8'));
  const url = values.VITE_SUPABASE_URL;
  const anonKey = values.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Add this new project’s VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to app/.env.local first.');
  }

  let projectUrl;
  try {
    projectUrl = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL in app/.env.local is not a valid URL.');
  }
  const projectRef = projectUrl.hostname.split('.')[0];
  if (projectUrl.protocol !== 'https:' || projectRef === originalProjectRef) {
    throw new Error('Refusing to import: the URL must be the HTTPS URL for the new Supabase project, not the original project.');
  }
  return { url, anonKey, projectRef };
}

async function loadDatasets() {
  const result = new Map();
  for (const [table, filename] of datasets) {
    const parsed = JSON.parse(await readFile(path.join(dataDirectory, filename), 'utf8'));
    if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`${filename} must contain a JSON array of records.`);
    }
    result.set(table, parsed);
  }

  for (const [table, rows] of result) {
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length || rows.some((row) => typeof row.id !== 'string' || !row.id)) {
      throw new Error(`${table} contains a missing or duplicate record ID.`);
    }
  }

  const buyerIds = new Set(result.get('buyers').map((buyer) => buyer.id));
  for (const table of ['buyer_sales', 'buyer_payments']) {
    if (result.get(table).some((row) => !buyerIds.has(row.buyer_id))) {
      throw new Error(`${table} contains a buyer reference that is missing from raw_buyers.json.`);
    }
  }

  return result;
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
    throw new Error('Run this import from an interactive terminal so the password can be entered without echoing.');
  }

  return new Promise((resolve, reject) => {
    let password = '';
    stdout.write('Owner Supabase password (input hidden): ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', function onData(chunk) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdout.write('\n');
          reject(new Error('Import cancelled.'));
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

async function readTableCount(client, table) {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Cannot check ${table}: ${error.message}. Confirm the core schema and owner setup have both succeeded.`);
  }
  return count ?? 0;
}

async function importTable(client, table, rows) {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const batch = rows.slice(offset, offset + chunkSize);
    const { error } = await client.from(table).upsert(batch, { onConflict: 'id' });
    if (error) {
      throw new Error(`Import stopped while writing ${table}, rows ${offset + 1}-${offset + batch.length}: ${error.message}`);
    }
  }
}

async function main() {
  const [{ url, anonKey, projectRef }, records] = await Promise.all([
    loadConfiguration(),
    loadDatasets(),
  ]);

  console.log('Local recovered-data import');
  console.log(`New Supabase project: ${projectRef}`);
  console.log('Records to import:');
  for (const [table, rows] of records) console.log(`  ${table}: ${rows.length}`);
  console.log('No record contents or credentials will be printed.');

  const email = await ask('Owner login email: ');
  const password = await askPassword();
  if (!email || !password) throw new Error('An owner email and password are required.');

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Owner sign-in failed: ${authError.message}`);

  for (const [table] of datasets) {
    const count = await readTableCount(client, table);
    if (count !== 0) {
      throw new Error(`Import stopped: ${table} already contains ${count} rows. No records were written. Check that this is the intended empty project.`);
    }
  }

  console.log('\nDestination checks passed; all six tables are empty.');
  if (await ask('Type IMPORT to upload the recovered records to this new project: ') !== 'IMPORT') {
    throw new Error('Import cancelled; no records were written.');
  }

  for (const [table, rows] of records) {
    await importTable(client, table, rows);
    console.log(`Imported ${rows.length} rows into ${table}.`);
  }

  console.log('\nImport complete. Verify the table counts and balances in Supabase before using the app.');
  await client.auth.signOut();
}

main().catch((error) => {
  console.error(`\nImport failed: ${error.message}`);
  process.exitCode = 1;
});
