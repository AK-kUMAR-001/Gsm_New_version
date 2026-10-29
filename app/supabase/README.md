# Supabase database changes

## New project setup

For a new project, run `202610100001_core_schema.sql` first in the project's
Supabase SQL Editor. It creates the six core app tables, indexes, and owner
configuration.

If the initial core SQL was already run before this owner-policy upgrade was
added, do not run the core SQL again; run only
`202610130001_secure_owner_policies.sql` before importing data.

After the core schema is installed:

1. In Supabase Authentication → Users, create the one owner login.
2. In SQL Editor, run the following query after replacing the placeholder with
   that exact login email:

   ```sql
   do $$
   declare
     owner_id uuid;
   begin
     select u.id into owner_id
     from auth.users as u
     where lower(u.email) = lower('REPLACE_WITH_OWNER_LOGIN_EMAIL');

     if owner_id is null then
       raise exception 'No Auth user found for that email. Create the owner login first.';
     end if;

     insert into app_private.gsm_traders_owner (user_id)
     values (owner_id);
   end;
   $$;
   ```

   Run this once. Do not expose or grant access to the `app_private` schema.
3. Run `202610130001_secure_owner_policies.sql` in SQL Editor. It checks that
   the owner is configured and restricts business-table access to that owner.
4. Disable public sign-ups in Supabase Auth. Only the configured owner should
   have an Auth account.
5. Import the recovered data into the six tables and verify imported row counts
   and balances. Import master records (`buyers`, `products`, and `suppliers`)
   before sales and payments so their foreign keys resolve.

The repository intentionally does not contain customer or transaction exports.
The local recovery JSON files can be imported separately; never commit or upload
them to the public GitHub repository.

For the local recovery checkout, the app includes a guarded import command. Put
the new project's URL and anon key in the ignored `app/.env.local` file, then
run `npm run import:recovered-data` from the `app` directory. It signs in as the
owner, verifies all six destination tables are empty, displays row counts without
record contents, and requires typing `IMPORT` before writing. It refuses the
original Supabase project URL. Do not run older root-level recovery scripts;
they target the original Supabase project.

After the data import has been checked, apply the app-specific migrations in this
order:

1. `202610110001_inventory_ledger.sql`
2. `202610110002_delete_buyer_data.sql`
3. `202610120001_low_stock_threshold.sql`
4. `202610130002_allow_historical_untracked_sales.sql` (only when importing a
   live backup into an existing ledger-enabled database)
5. `202610130003_enforce_stock_before_sales.sql` after the import is complete
6. `202610130004_set_stock_quantity.sql` to enable setting an exact stock
   balance, including zero
7. `202610150001_product_units_and_historical_conversion.sql` after the
   historical import and ledger reconciliation are complete
8. `202610150002_daily_stock_reset.sql` to start each India-time calendar day
   with zero available stock until that day's count or stock entries are recorded
9. `202610150003_sale_input_unit_conversion.sql` to convert any still-original
   15 Oct Malli/Pudina sale entries and add unit-aware sale RPCs
10. `202610150005_reconcile_sale_movement_units.sql` if 15 Oct stock movements
    still show the original Mootai quantities as Kattu; it verifies the saved
    sale totals against the original records, then normalizes only linked sale
    movement quantities without changing costs or morning counts
11. `202610150004_repair_sale_cost_unit_conversion.sql` only if migration 003
    was run with the earlier cost-multiplication bug and the report totals match
    its guarded 15 Oct values. Run 005 before 004 if 004 has not yet been
    applied, since 004 expects canonical movement quantities. If 004 is already
    applied, 005 can still be run afterward to reconcile quantities.
12. `202610160001_buyer_lifecycle.sql` to add archive/restore, the Archived
    Customers view, and audited permanent deletion support. Apply it after
    `202610110001_inventory_ledger.sql` and `202610110002_delete_buyer_data.sql`.
    Run it in the Supabase SQL Editor for the new project; the app requires
    this migration for archive and permanent deletion actions.
13. `202610160002_transaction_corrections.sql` to enable owner-authorized
    editing and deletion of buyer sales, retail sales, and buyer payments.
    Apply it after `202610160001_buyer_lifecycle.sql`; sale corrections use
    database functions to keep the inventory ledger consistent. If you applied
    an earlier copy before the final hardening updates, rerun the current file
    in the Supabase SQL Editor before using transaction corrections.
14. `202610170004_historical_entries_and_stock_corrections.sql` to allow
    owner-authorized sales dated in the past when the tracked product has a
    physical count and enough stock recorded for that date, and to enable
    dated closing-stock corrections from Reports.
15. `202610220001_correct_morning_count_and_reprice_sales.sql` to correct
    today's physical morning count after sales have been entered. It preserves
    saved sales quantities, recalculates today's outbound stock costs using the
    corrected purchase cost, and records corrections in a private audit table.
16. `202610230001_rebuild_oct22_stock_from_verified_count.sql` is a one-time
    repair for 22 Oct 2026. It archives that date's existing counts and stock
    movements in a private audit table, preserves all buyer and retail sales,
    replaces non-sale stock movements with the verified Malli, Pudina, and
    Karuvepillai morning counts and costs, and recalculates linked sale costs.
    It aborts without committing if any recorded sale is missing a matching
    movement or the verified count cannot cover the sales. The final query
    reports per-product revenue, sale cost, profit, and closing balance.
17. `202610230002_correct_historical_morning_count_and_reprice_sales.sql` adds
    owner-authorized correction of an existing past-date morning count from
    Reports. It preserves sales and receipts, recalculates that day's outbound
    movement costs from the corrected count cost, and audits each correction in
    a private table. It aborts if the corrected count cannot cover the recorded
    stock movements.
18. `202610260001_retail_day_start_finish.sql` enables the owner to start daily
    retail sales after recording physical counts and setting a price in each
    tracked product's sales unit. Buyer and recorded retail sales reduce the
    live balance.
19. `202610270001_remove_retail_day_finish.sql` removes the retail-day finish
    RPC. Remaining stock stays in inventory and is never recorded as sold
    automatically.
20. `202610270002_delete_morning_count.sql` adds an owner-authorized action to
    delete today's morning count and its associated count-adjustment or
    revaluation movement. Other stock movements and saved sales are retained.
    Deleted count details are kept in a private audit table before the count is
    removed so a fresh count can be recorded.
21. `202610270003_delete_stock_and_reopen_retail_day.sql` adds owner-authorized
    stock-movement deletion with private recovery snapshots, including receipts
    and stock corrections. Deleting a morning count also reopens that date's
    retail session and removes only its generated balance-close sales; the
    existing one-argument morning-count RPC remains available to the app.
22. `202610270004_harden_permanent_buyer_delete.sql` ensures permanent buyer
    deletion snapshots the buyer and linked sales, payments, and stock
    movements before removing those live records. Apply it after the buyer
    lifecycle and transaction-corrections migrations.
23. `202610290001_record_historical_morning_count.sql` enables adding a missing
    past-date morning count from Reports. It preserves sales and stock receipts,
    recalculates outbound movement costs using the entered count cost, and
    stores a private snapshot of the previous movements. It aborts if the date
    already has conflicting opening/count movements, a sale lacks its linked
    stock movement, or the count cannot cover that day's movements.

The inventory migration is additive and changes tracked sales to require a
same-day physical stock count before insertion. The final enforcement migration
also requires stock tracking for every newly recorded sale and rejects sales
that exceed the usable balance. Existing sale rows are not rewritten.
The daily retail migration adds owner-only session and price tables and a
start RPC. The Retail and Reports pages load the selected date's session and
saved prices, and derive that date's available balance from only its stock
movements, so buyer and retail sales both reduce the displayed balance
without carrying stock across dates. The Retail page shows remaining-stock
value and potential profit using only that date's saved retail prices and
remaining stock cost; these are estimates, not realized profit. The dashboard
and daily closing report combine linked buyer/recorded-retail profit with
potential profit on remaining stock only when that same date has saved retail
prices. Unsold balances are not inserted as sale transactions.

The `202610120001_low_stock_threshold.sql` migration adds a configurable warning
level to tracked products. It defaults to 5 of the product's sales units; set it
to 0 to turn off the warning for a product. The app displays warnings on the
dashboard and Daily Stock In page and refreshes the balance after a successful
sale. Warnings are shown only after a positive opening, receipt, count surplus,
or stock correction has been recorded for the product.

Historical sale entry requires the selected date's physical count and enough
recorded stock for the sale. Closing-stock corrections are recorded against
that date in the ledger and do not carry forward to other dates, matching the
daily closing report's existing day-by-day balance behavior.

The product-unit migration sets product-specific sales and stock-entry units.
Its initial configuration is Pudina: 200 Kattu per Mootai; Malli: 50 Kattu per
Mootai; Karuvepillai: Kg for both stock and sales. Sales dated 13 Oct 2026 or
later, tracked stock movements, counts, and low-stock thresholds for these
products are converted to the configured sales unit. Sale revenue and stock
value are preserved; earlier sales keep their saved Mootai units. The migration
stops rather than silently mixing units if these tracked products have stock
movements or counts before 13 Oct 2026. After transactions exist, product unit
settings are protected from edits that would reinterpret saved quantities.

The sale input-unit migration is safe to run after the product-unit migration.
It converts only 15 Oct Malli/Pudina rows that still have their original
per-Mootai rates, and leaves rows already converted by the earlier migration
unchanged. If it finds a mix of original and converted rates for that date, it
stops for review rather than risk a double conversion. It also adds buyer and
retail RPCs that convert entered Mootai quantities and rates to canonical
accounting units before saving. The conversion preserves sale totals and
updates the matching sale stock quantities while preserving each movement's
total cost; it does not change morning counts or invent missing stock. Any
negative balance after conversion is a real reconciliation issue and must be
resolved from verified stock records before relying on profit.

Sale histories dated through 15 Oct 2026 display in their original Mootai/Kg
units and rates, while stock, revenue, and profit calculations continue to use
the normalized accounting quantities internally. Sales dated 16 Oct 2026 or
later display both the entered stock unit and its equivalent sales unit; buyer
and retail entry forms allow selecting either unit and normalize it before
saving.

The one-time 004 repair is for databases where an earlier version of migration
003 also multiplied linked Malli/Pudina sale movement costs by 50/200. It
divides only the matched 15 Oct movement costs back by those factors, and aborts
unless the migrated sales, quantities, revenue, and cost totals match the
verified report snapshot. It does not change sale revenue, quantities, counts,
or non-sale movements.

The 005 reconciliation verifies the original 15 Oct totals (Malli 4,975 Kattu,
Pudina 27,200 Kattu, and Karuvepillai 33.5 Kg) and requires each of the 11 buyer
sales to have exactly one linked movement with either its original or canonical
quantity. It then writes each linked movement's canonical quantity and unit,
without changing sale rows, movement costs, or morning counts. It deliberately
does not create missing 14 Oct stock movements or receipts; their stock cost
and opening-stock history must be verified separately.

The daily stock reset migration makes the displayed and enforced available
balance, its average cost, and stock corrections use only movements dated today
in India time. Yesterday's closing stock remains in the ledger for historical
reports but does not carry into today's available balance. Record today's
physical count or stock entry before making sales; an untouched product is
shown as not entered today.

Daily closing uses only movements dated on the selected day, consistent with
the daily stock reset. Daily final profit is sales revenue minus linked sale
stock cost and recorded spoilage cost; it is shown as unavailable when any
tracked sale is missing its linked cost.

Before applying the inventory and low-stock migrations to a new database:

1. Verify the imported records and balances.
2. Test opening stock, morning counts, receipts, sales, spoilage, corrections,
   retries, and overselling in this new project.
3. Reconcile balances before using inventory features for live business.

Tracked products require an initial opening stock record and a physical count
for each current India Standard Time date before a sale can be recorded. Each
date's available balance starts at zero; only that date's count and movements
are usable for sales. The sale row and its stock deduction are written in one
database transaction. Historical sales remain untracked and their costs are not
inferred.

For the live-data clone, run the historical-untracked-sales migration before
syncing so the recovered past sales can be imported. After verifying the
import, apply `202610130003_enforce_stock_before_sales.sql`; it closes the
temporary allowance for new untracked sales without modifying historical rows.
Apply `202610130004_set_stock_quantity.sql` to enable the Inventory page's
Edit stock action to set the exact available balance, including zero. This
records only the balance difference as a correction; it does not rewrite past
movements or sales.
Buyer deletion follows the inventory ledger because it cooperates with the
ledger's sale-protection triggers.

## Refreshing from a live backup

Use `npm run sync:live-backup -- "C:\path\to\gsm-traders-backup.json"` from
the `app` directory to merge a version 1 GSM Traders backup into the new
project. Put only the new project's URL and anon key in `.env.local`; this
command rejects the original project URL and asks for the new project's owner
login with the password entered without echoing it.

For a database where the inventory ledger migration has already been applied,
run `202610130002_allow_historical_untracked_sales.sql` in the new project's
SQL Editor before syncing. It preserves the today-and-count safeguards for
stock-tracked products while allowing historical sales for untracked products.
Once the sync and reconciliation are complete, run
`202610130003_enforce_stock_before_sales.sql` to require stock tracking and
sufficient stock for all future sales.
The sync refuses new sales that would affect a tracked product or transaction
IDs whose saved values differ between the backup and destination.

The command previews counts, creates a private backup of the destination under
`%USERPROFILE%\.gsm-traders-backups`, and requires typing `SYNC`. It upserts
buyer/product/supplier master rows, adds missing sales and payments by ID, and
never deletes destination-only rows. It verifies all final table counts and
prints today's totals without showing customer or transaction details. The
command is idempotent; if a network error interrupts it, inspect the result and
rerun it with the same backup.

The buyer lifecycle migration keeps archived buyers and all their historical
sales, payments, and stock movements in the live database, so reports and
aggregates remain unchanged. It removes archived buyers from the normal buyer
list and allows them to be restored. Permanent deletion is only allowed after
archiving and runs in one database transaction: it first copies the buyer,
sales, payments (including a legacy `payments` table when present), and linked
buyer-sale inventory movements to `app_private.buyer_purge_recycle_bin`, then
removes those records and movements from live tables. The recycle bin is not
granted to `anon` or `authenticated` and is not exposed through the app. The
The migration revokes direct authenticated deletes on buyer-linked tables and
disables the older delete RPC so permanent deletion cannot bypass the backup.
The app has no client-side partial-delete fallback; missing migration or RPC errors leave
the live data untouched and are reported to the operator.

The transaction-corrections migration provides the audited workflow for saved
buyer sales, retail sales, and buyer payments. The app uses these RPCs instead
of directly editing or deleting tracked transactions. Apply the latest
`202610160002_transaction_corrections.sql` revision before using the correction
controls so its stock checks and table permissions are current.
