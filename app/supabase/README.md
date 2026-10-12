# Supabase database changes

The `migrations` directory contains the v0.2 inventory-ledger migration. It is
additive, but it adds sale triggers and changes tracked sales to require a same-day
physical stock count before insertion.

The `202610120001_low_stock_threshold.sql` migration adds a configurable warning
level to tracked products. It defaults to 5 Mootais; set it to 0 to turn off the
warning for a product. The app displays warnings on the dashboard and Daily Stock
In page and refreshes the balance after a successful sale.

Neither migration has been applied to a database. Before applying them anywhere:

1. Take and verify a database backup.
2. Apply it to a non-production Supabase project first.
3. Confirm the existing `products`, `suppliers`, `buyer_sales`, and `retail_sales`
   schemas and authenticated-role policies match the migration assumptions.
4. Test opening stock, morning counts, receipts, sales, spoilage, corrections,
   retries, and overselling in that project.
5. Reconcile balances before separately authorizing any production rollout.

Tracked products require an opening stock record and a physical count for the
current India Standard Time date before a sale can be recorded. The sale row and
its stock deduction are written in one database transaction. Historical sales
remain untracked and their costs are not inferred.

Apply the inventory-ledger migration before the low-stock-threshold migration.
Both are unapplied; applying either migration is a database change and must be
approved and tested separately.

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
