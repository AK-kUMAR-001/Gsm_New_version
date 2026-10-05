# Specification: GSM Traders — Full Web App Rebuild

## Problem

GSM Traders operates a live website at `https://gsm-traders.vercel.app/` that manages a Malli Leaf (Jasmine/flower buds / malli, pudina/mint, karuvepillai/curry leaves, poondu/garlic) trading business in Ukkadam Market, Coimbatore. The original app is a single-owner Supabase-backed web application that tracks buyer credit sales, retail (cash) sales, and buyer payments. The user wants a **100% exact replica** of the running application — including every page, every navigation entry, every color, every font size, every modal, every badge, every button interaction, every filter pill, every sort order, every computed ledger balance, and every statistic — built locally in this repo.

## Users

- Single authenticated owner user (`gsmtraderscbe@gmail.com`) of GSM Traders.

## Goals

1. Build an exact visual pixel-level replica of the live site: same layout, same sidebar widths, same card radii, same exact colors (`#1a1a2e` sidebar, `#0f3460` accent, `#05df72` green, `#8200da` purple), same Plus Jakarta Sans typography, same card border/hover styles, same exact form inputs and modal design.
2. Implement **100% of the business logic** exactly as the live site performs it: buyer balance due = sum(sales) − sum(payments), "Today" metrics filtered by local date, outstanding count = buyers with balance_due > 0, cleared count = balance_due == 0, product revenue aggregation, top buyer list sorted by balance descending, recent activity merged list, date-range period filters (This Week / This Month / 3 Months / All).
3. Use the **same Supabase project** (`SUPABASE_URL = https://yfxinmfkfttzuwgmmifl.supabase.co`, same anon key) so sign-in and all writes go to the actual live production tables (`buyers`, `products`, `suppliers`, `retail_sales`, `buyer_sales`, `buyer_payments` / `payments`) with the exact same column names.
4. **Pages / routes** must match the live site: `/login → /dashboard → /buyers → /buyers/:id → /retail → /reports → /products` with identical React Router style SPA navigation and sidebar current-link highlighting.
5. The app must also work with the **recovered raw JSON data in new_recovery/06_raw_backup/** as a read-only demo mode when Supabase is unreachable or user is offline, so the UI renders exactly the same with local data.

## Non-Goals

- No additional features beyond the live site (no stock/inventory, no suppliers page unless confirmed to exist in the live app, no invoice PDF rendering if live site doesn't generate one).
- No multi-user / RBAC. Single owner only.
- No server-side rendering. Vite + React SPA is fine (matches the live static deployment on Vercel).

---

## Functional Requirements

### FR-1 · Authentication & Layout Shell

- **FR-1.1** Unauthenticated users see `/login` only. Attempts to access any route redirect to `/login`.
- **FR-1.2** Login page exactly matches design: full-viewport gradient bg (`#1a1a2e → #16213e → #0f3460` top-right), 64px green rounded square leaf logo, heading "GSM Traders" 24/700 white, subtitle "Ukkadam Market Road, Coimbatore" light grey. Centered rounded-2xl translucent card with "Welcome back" heading, Email/Password labels + inputs with UPPERCASE labels, 👁 password toggle, wide pill-shaped bright green (`bg-green-500`) "Sign In" button. Footer line "Single-owner secure access · GSM Traders" small centered.
- **FR-1.3** Sign in uses Supabase email/password `signInWithPassword`. Correct auth token is stored and all subsequent Supabase RPCs use the session. Error messages display inline on invalid credentials.
- **FR-1.4** Authenticated layout: 256px fixed left sidebar (`bg-[#1a1a2e]`, text-white, `lg:w-64`), hidden `< lg` with mobile toggle. Sidebar has:
  - Logo tile + "GSM Traders" at top, divider line
  - Nav links (with icons in matching size/order): **Dashboard** / **Buyers** / **Retail** / **Reports** / **Products** — each white/70 default, hovered white + `bg-white/5`, active page shows `bg-white/10` highlight.
  - Divider at bottom, **Logout** icon button which calls `supabase.auth.signOut()` and returns to `/login`.
- **FR-1.5** Main content area (flex-1) uses `bg-gray-50 #f9fafb`, `px-6 py-6 lg:px-8 lg:py-8`, max-width constrained gutters matching live site.

### FR-2 · Dashboard (`/dashboard`)

- **FR-2.1** Page header: "GSM Traders" 24/700 bold, "Ukkadam Market, Coimbatore" grey subtitle.
- **FR-2.2** Hero stat card (dark navy rounded-2xl, `bg-[#0f3460]/90` gradient feel): "TOTAL BUYER CREDIT PENDING" uppercase label, giant Indian Rupee amount with comma separators and bold weight, subline "Amount to collect from all buyers".
- **FR-2.3** 4 metric cards in a responsive grid (lg: 4-col, md: 2-col, sm: 1-col), each white card with 16px rounded corners + colored 1px left/lite border (green, purple, blue, amber):
  1. TODAY – BUYERS: ₹ billed today from `buyer_sales` (sale_date == today), green `#00c758`.
  2. TODAY – RETAIL: ₹ retail today, purple.
  3. TODAY – TOTAL: sum of both, blue with tiny up-right arrow icon.
  4. BUYERS WITH DUES: count of buyers with balance > 0, amber warning triangle icon.
- **FR-2.4** Two quick-action tiles (lg: 2-col, sm: 1-col stacked):
  1. "Buyer Sale / Payment" — dark navy tile, navy rounded icon badge left, title+subtitle "Record credit sales & collections", chevron right icon. Click navigates to `/buyers` (or opens action sheet mobile).
  2. "Retail Sale" — deep purple tile, storefront icon, "Walk-in / cash sale". Click navigates to `/retail`.
- **FR-2.5** "Top Outstanding Buyers" card (h2 14/700): list of 5 buyers with highest balance due, each as clickable row with colored initials circle, name, amount in Indian Rupee red pill, chevron, navigates `/buyers/:id`.
- **FR-2.6** "Recent Activity" card (h2 + refresh icon): merged chronological list of latest 8 buyer_sales + buyer_payments mixed. Rows show: product emoji + name · buyer name for sales or ✅ Payment · buyer name, date in "DD MMM YYYY" format, amount right-aligned (positive for sale, green for payment). End with "View full reports →" link to `/reports`.

### FR-3 · Buyers list (`/buyers`)

- **FR-3.1** Page header: "Buyers" h1, subtitle "N buyers" (count), right-aligned pill "+ Add Buyer" dark button.
- **FR-3.2** 4 metric summary cards: BUYERS (count), OUTSTANDING (red count of buyers with balance>0), PENDING (total balance due, amber ₹), CLEARED (green count balance=0). Same white rounded-2xl card style.
- **FR-3.3** Search input: full width rounded-xl, magnifier icon left, placeholder "Search buyers…", filters name + phone in real-time.
- **FR-3.4** Filter pills row, left-aligned: "All" (selected default dark pill), "Outstanding" (grey pill, only buyers balance>0), "Cleared", "High Due > ₹10k". Right side "SORT" label + combobox: **Highest Due** default / Lowest Due / Name A–Z.
- **FR-3.5** Buyer cards 2-col grid (lg) / 1-col (sm), each: rounded-2xl white, hover shadow translate-y -0.5, left colored circle (2-letter initials, color picked from fixed palette by name hash), name 16/600, phone grey 14, right side red pill with ₹ due, chevron clickable → `/buyers/:id`. If balance==0 show green "Clear ✓" chip instead of ₹.
- **FR-3.6** Add Buyer modal: dark backdrop blur, centered white rounded-2xl panel, close × top-right, title "Add New Buyer". Fields (uppercase labels): NAME* (required input), PHONE (OPTIONAL) with +91 flag prefix input, ADDRESS (textarea). Bottom pill "Add Buyer" dark navy button. Submits via `supabase.from('buyers').insert({ name, phone, address })` with Supabase gen UUID and created_at default.

### FR-4 · Buyer Detail (`/buyers/:id`)

- **FR-4.1** Back arrow (←) returns `/buyers`. Header row: large teal/colored initials circle + name 24/700 + phone 14 grey. Right: outline pill "Edit" button (opens edit modal — same fields as add). Info line: "LAST PURCHASE DD MMM YYYY · LAST PAYMENT DD MMM YYYY" in grey uppercase labels + values.
- **FR-4.2** Hero balance card (same dark navy as dashboard): "BALANCE DUE" label, giant yellow/gold ₹ amount, divider, then 2-col "BILLED" white ₹ and "RECEIVED" green ₹ numbers computed from sum buyer_sales / sum buyer_payments.
- **FR-4.3** 3 action buttons (lg 3-col, sm stacked): dark pill "+ Record Sale", bright green pill "+ Record Payment", outline pill "📄 Invoice" (placeholder non-functional unless live site does it).
- **FR-4.4** Tabs (2-tab segmented): **Sales** (dark filled active) / **Payments** (grey inactive toggle).
- **FR-4.5** Period filters row: This Week / This Month (default for buyer page) / 3 Months / All. Filter rows accordingly.
- **FR-4.6** Sales table/list rows: date, product emoji+name, mootais qty, price/mootai, total ₹ amount, notes if any. Payment rows: date, ₹ amount received, notes.

### FR-5 · Retail (`/retail`)

- **FR-5.1** Header: "Retail Sales" h1 + subtitle. Top right icon buttons: circular Refresh arrow + dark pill "+ Record Sale".
- **FR-5.2** Summary header card: "All-time Revenue" label + big ₹ total with count of sales.
- **FR-5.3** Period pills: **This Week / This Month / All** (3 pills; if live site has 3 Months too include it). Filter rows accordingly.
- **FR-5.4** List of retail entries grouped or sorted by date DESC: product emoji+name, date DD MMM YYYY, mootais sold, price per mootai, total ₹. Record Sale modal opens form with: product dropdown (only active products), mootais number, price_per_mootai, sale_date date input default today, notes optional.

### FR-6 · Reports (`/reports`)

- **FR-6.1** Header: "Reports" h1. Top 4 period pills: This Week / **This Month** default / 3 Months / **All Time**. When switching period, all numbers and charts update to filtered range.
- **FR-6.2** 3 summary cards (lg: 3-col): TOTAL (green label + big ₹ combined buyer+retail in range), BUYERS (navy label ₹ total from buyer_sales), RETAIL (purple label ₹ total from retail_sales).
- **FR-6.3** 2-card grid:
  - Left "Buyer vs Retail Revenue" bar chart. X-axis date labels (per period granularity), y-axis in rupees (0k, 1500k, etc), green bars for Buyers, tiny purple bars for Retail. Legend bottom.
  - Right "Sales by Product" ranked list: each row shows product emoji+name, "Mootais sold" count in grey, big green ₹ total to right.
- **FR-6.4** Below (full width): "Top Buyers" for the selected period — ranked list with amount.

### FR-7 · Products (`/products`)

- **FR-7.1** Header: "Products Master" h1, subtitle "N products · N active" (count of active=true), right "+ Add" dark pill. Long description text: "Configure the products used across buyer sales and retail. Set an emoji and a name for each. Hidden products stay on past records but won't appear in entry forms."
- **FR-7.2** Accordion list for each product (sorted by sort_order ASC): rounded-2xl white cards, chevron-down toggles open/closed. Expanded shows editable fields: Emoji picker/icon, Name, Active toggle switch, Sort Order number, save/cancel buttons. Also expandable edit controls.
- **FR-7.3** Label tag: "Primary" badge green for top active products, "Occasional" grey text for inactive or lower sort_order items.

### FR-8 · Business Logic & Computations (must match live site exactly)

- **FR-8.1** `balance_due(buyer) = Σ buyer_sales[mootais*price_per_mootai] WHERE buyer_id = id − Σ buyer_payments[amount_paid] WHERE buyer_id = id`
- **FR-8.2** "Today" comparisons use Indian Standard Time (IST, UTC+5:30) date match against stored `sale_date` (YYYY-MM-DD string) / `paid_at` (YYYY-MM-DD string), NOT `created_at` timestamp.
- **FR-8.3** Outstanding buyer = balance_due > 0. Cleared = balance_due == 0 (even if past dues existed, paid fully now).
- **FR-8.4** `outstanding_total` = sum over all buyers of max(0, balance_due(buyer)). Must equal dashboard hero + buyers summary card.
- **FR-8.5** Recent Activity ordering: mix buyer_sales and buyer_payments by (sale_date or paid_at) DESC, top 8 rows. Display payment entries with green + Payment prefix and green amount text.
- **FR-8.6** Highlighted "Today" on both dashboard metric cards: if no entries exist for today, value displays ₹0, not empty.
- **FR-8.7** All currency values render with `₹` prefix, Indian locale grouping commas (₹55,59,281 — lakh format). Use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })` without decimals.
- **FR-8.8** Pagination for buyer_sales when rows > 1000: fetch in Supabase range pages 1000 rows at a time silently so ledger never truncates (like the paginated export script).
- **FR-8.9** Insert writes: new inserts of `buyer_sales` / `retail_sales` / `buyer_payments` use exactly these column names: buyer_id, product, mootais (or mootais_sold on retail_sales), price_per_mootai, sale_date, amount_paid, paid_at, notes, id (UUID auto), created_at (default now()).

---

## Non-Functional Requirements

- **NFR-1** Tech stack exact match to live site: **Vite + React 18, React Router DOM (SPA), Tailwind CSS v3 with Plus Jakarta Sans from Google Fonts, @supabase/supabase-js v2**.
- **NFR-2** Responsive breakpoints match Tailwind defaults (`sm: 640, md:768, lg:1024`). Sidebar collapses below lg=1024px.
- **NFR-3** Color palette must use the exact tokens extracted from live:
  - Sidebar: `#1a1a2e`
  - Hero / primary accent navy: `#0f3460`
  - Mid gradient: `#16213e`
  - Primary green: `#05df72` (hover `#00c758`)
  - Primary purple: `#8200da`
  - Text: `#101828` / `#4a5565` labels / `#99a1af` mutes
  - Bg: `#f9fafb`
  - Card radii: `12px / 16px / 24px` (xl/2xl/3xl) matching live Tailwind classes.
- **NFR-4** No public exposure of passwords, no secret keys in bundle except the **already-public Supabase anon key** (same as live site).
- **NFR-5** Offline fallback: if Supabase network fetch fails on start (e.g. first run on laptop without internet), load fallback data from `new_recovery/06_raw_backup/` JSON in read-only mode (no inserts allowed, show persistent banner "Demo mode – using local backup data").
- **NFR-6** Dev server (`npm run dev`) must compile cleanly with no TypeScript/JS errors, production build (`npm run build`) must produce deployable static `dist/` that works on Vercel exactly as the live app.

---

## Constraints / Dependencies / Assumptions

- Uses existing Supabase project URL and anon key (both already public and used by the live app).
- Assumes RLS policies in the live Supabase project match the original (anon key can only do anything after signInWithPassword for the single owner user).
- Assumes browser Supabase Auth session persistence (localStorage) same as live app.
- Font: "Plus Jakarta Sans" loaded from Google Fonts via `<link rel="preconnect" />` + `@import` or `<link>`.

## Open Questions

- **Q1** Suppliers page? User navigation says /dashboard /buyers /retail /reports /products. Sidebar doesn't list Suppliers on live site, so suppliers page is OUT unless user says otherwise.
- **Q2** Is there a mobile drawer/hamburger on small screens? (Assume yes, standard pattern matching the sidebar nav.)
- **Q3** Does the "Invoice" button on buyer detail generate anything or is it stub UI? (Current live data screenshots: stub button. Build as stub with toaster "Invoice coming soon" unless live site has actual.)

---

## Acceptance Criteria

### Rule AC-1
**Visiting `/` without session redirects to `/login`; after correct Supabase login it redirects to `/dashboard` and sidebar shows all 5 nav items + Logout. Evidence: screenshot + browser network tab showing Supabase auth request.**

### Rule AC-2
**Dashboard hero "Total Buyer Credit Pending" amount = sum(max(0, Σ sales − Σ payments)) for every buyer, to the rupee, matching the live app value on All-Time for same data. Evidence: screenshot compared to live site screenshot + JSON logged calculation.**

### Rule AC-3
**All 7 pages render (login, dashboard, buyers, /buyers/:id, retail, reports, products) with matching layout, colors, period pills, search/filter/sort controls. Evidence: screenshots side-by-side for each page.**

### Rule AC-4
**"Add New Buyer" modal submits → supabase.insert to buyers succeeds → new row shows instantly at top of buyers list with balance 0 CLEARED badge. Evidence: network tab POST success + UI list updated.**

### Rule AC-5
**Recording a buyer sale with product X, mootais=q, rate=r, date=d updates buyer balance += q*r instantly (no page reload) and appears in Recent Activity. Evidence: before/after balance + new row in activity list.**

### Rule AC-6
**Recording a buyer payment subtracts from balance (makes balance_due smaller) and moves buyer Outstanding→Cleared if hits 0. Evidence: before/after cleared count metric.**

### Rule AC-7
**Reports "All Time" TOTAL card = (Buyers card + Retail card) to the rupee; Buyer vs Retail bar chart July 2026 peak matches live screenshot height. Evidence: screenshots + math check from raw JSON.**

### Rule AC-8
**Buyers page filter pills "All / Outstanding / Cleared / High Due > 10k" + sort combobox "Highest Due / Lowest Due / Name A-Z" produce correctly filtered & ordered buyer cards matching live results. Evidence: screenshots after clicking each filter.**

### Rubric AC-9
**Visual fidelity (0–5 scale). Threshold ≥4.**
- `5`: pixel-perfect — a side-by-side screenshot diff vs live shows no visible differences except generated amount values; hover/active states identical.
- `4`: extremely close; only very minor spacing differences (<4px) on low-importance items; all major cards, sizes, colors, font weights match exactly.
- `3`: recognizable same app but spacing, colors, or sizing visibly off in several places.
- `2`: substantial styling mismatch but correct content layout.
- `1`: barely resembles the live app.
- `0`: completely different style.

**Evidence source:** Screenshots of rebuilt pages vs live (`login-page.png`, `dashboard-full.png`, `buyers-page-full.png`, `reports-full.png`, `retail-products-reports.png`, `buyer-detail-page.png`, `add-buyer-modal.png`).

### Rubric AC-10
**Business logic correctness (0–5). Threshold ≥4.**
- `5`: every computed number (balance, totals, today-cards, outstanding count, cleared count, period filters) matches live site exactly for identical data.
- `4`: 1 tiny edge case wrong (e.g. midnight IST date boundary by 1 day) but all key figures correct.
- `3`: ≥2 numbers off by more than rounding.
- `2`: many computations inconsistent.
- `1/0`: ledger broken.
**Evidence: compare figures from `new_recovery/05_reports/OVERVIEW.json` and live site dashboard cards.**
