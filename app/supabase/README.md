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

The inventory migration is additive, but it adds sale triggers and changes tracked
sales to require a same-day physical stock count before insertion.

The `202610120001_low_stock_threshold.sql` migration adds a configurable warning
level to tracked products. It defaults to 5 Mootais; set it to 0 to turn off the
warning for a product. The app displays warnings on the dashboard and Daily Stock
In page and refreshes the balance after a successful sale.

These migrations have not been applied to the new database. Before applying them:

1. Verify the imported records and balances.
2. Test opening stock, morning counts, receipts, sales, spoilage, corrections,
   retries, and overselling in this new project.
3. Reconcile balances before using inventory features for live business.

Tracked products require an opening stock record and a physical count for the
current India Standard Time date before a sale can be recorded. The sale row and
its stock deduction are written in one database transaction. Historical sales
remain untracked and their costs are not inferred.

After checking the imported records, run the inventory ledger, buyer-deletion,
and low-stock migrations in the order above. Buyer deletion follows the
inventory ledger because it cooperates with the ledger's sale-protection
triggers.

The `202610110002_delete_buyer_data.sql` migration adds the buyer delete action.
It permanently removes the buyer, all buyer sales and payments, and (if the
inventory ledger exists) the sale movements linked to those sales. Removing
the sale movements increases the stock balance for tracked products; this is
explained in the confirmation dialog. This migration can be applied with or
without the inventory-ledger migration. The delete RPC has not been applied
to a database. If the RPC is missing, the app tries direct deletes using the
signed-in user's database permissions. Direct deletes run as separate requests,
so a later permission error can leave some linked rows already deleted; the app
reports this instead of showing a success message. Tracked-sale protections
can also reject direct deletion.

The migration does not provide a general correction workflow for saved
transactions. Tracked sale edits and direct deletions remain blocked; do not
edit transaction rows directly. Complete and test audited correction
operations before treating v0.2 as production-ready.
