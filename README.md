# GSM Traders — Data Export Script

## What this is
A small script that logs into your own Supabase-backed GSM Traders
app using YOUR real login (same email/password as the app's login
page) and exports whatever tables it can read into JSON files.

It uses your project's public "anon" key (safe to be public — this
is how the deployed app itself talks to Supabase) combined with your
real credentials to authenticate. It does not bypass authentication
or Row Level Security — it only reads what your logged-in account is
already allowed to read.

## Setup

```bash
npm install @supabase/supabase-js
```

## Run

```bash
node export-data.js
```

You'll be prompted for your email and password (password input is
masked). These are sent directly to Supabase's auth server over
HTTPS — never logged, never sent anywhere else, never seen by anyone
but you.

## Output

A new `export/` folder will contain one `<table>.json` file per table
it successfully found and could read, e.g.:

```
export/
  buyers.json
  products.json
  retail.json
  reports.json
```

## If your tables aren't found

The script guesses common table names (`buyers`, `products`, `retail`,
`stock`, `invoices`, etc.). If none match, open the script and add
your real table names to the `CANDIDATE_TABLES` array near the top —
or paste me the error output and I'll help narrow it down.

## Safety notes

- **Never commit or share this folder** once it has your `export/`
  data in it — it will contain your real business data.
- **Never paste your password into a chat** with me or anyone else.
  This script exists specifically so you don't have to.
- If you ever *did* paste a Supabase password or full DB connection
  string into a chat, rotate it immediately at:
  Supabase Dashboard → Project Settings → Database → Reset password.
