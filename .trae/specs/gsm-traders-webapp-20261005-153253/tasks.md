# Implementation Tasks — GSM Traders Web App

Spec file: [spec.md](./spec.md)

---

## Task 1: Bootstrap Vite + React + Tailwind project shell

**Priority:** `high`
**Status:** `pending`
**Covers:** NFR-1, NFR-2, NFR-3 (partial)

### Work
Create a new subfolder `d:\gsm-recovery\app\` and run Vite React template setup. Install exact deps: `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `tailwindcss@3`, `postcss`, `autoprefixer`. Configure tailwind with:
- Content paths covering `app/index.html` + `app/src/**/*.{js,jsx,ts,tsx}`
- Custom theme colors matching live exact hex: `#1a1a2e / #16213e / #0f3460 / #05df72 / #8200da` plus the color tokens from evaluate output.
- Plus Jakarta Sans as default `font-sans` family via Google Fonts `<link>` in index.html.
- Router BrowserRouter, Supabase client singleton `src/lib/supabase.js` with existing URL+anon key.
- Global layout css variables, bg `#f9fafb` body defaults.

### Test Requirements (TR)

- **rule TR-1.1:** `npm install` succeeds in `app/` with zero critical audit warnings, `npm run dev` starts on `http://localhost:5173/` without errors in console. Evidence: terminal output + dev server running.
- **rule TR-1.2:** Tailwind renders a test `<div className="bg-[#1a1a2e] text-white font-sans">GSM Traders</div>` with correct rendered background color + font. Evidence: screenshot.

**Dependencies:** None.

---

## Task 2: Auth shell + Sidebar layout + Routing

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-1.1, FR-1.2, FR-1.3, FR-1.4, FR-1.5, AC-1

### Work
- `src/App.jsx`: Route config with route guards (protected wrapper checks Supabase session; redirects `/login`).
- `src/pages/Login.jsx`: Exact replica login page (gradient bg, leaf svg logo, heading, card, labels, email/psswd inputs with toggle, SignIn button, error display, footer line).
- `src/components/Sidebar.jsx`: 256px dark sidebar (`#1a1a2e`), logo area, 5 nav links with matching lucide-react icons (LayoutDashboard, Users, Store, BarChart3, Package) with icons in correct order, active page highlight `bg-white/10`. Logout button (LogOut icon) at bottom. Mobile drawer toggle for <lg.
- `src/components/AppLayout.jsx`: wraps children with Sidebar + main content padding.
- Supabase auth state listener — onAuthStateChange keeps user in React context.

### Test Requirements

- **rule TR-2.1:** Loading `/` without session → redirects `/login` (visible in URL after 1s). Evidence: browser screenshot.
- **rule TR-2.2:** Entering correct credentials (gsmtraderscbe@gmail.com / 12345678) → redirects to `/dashboard`, sidebar shows 5 nav entries + Logout button. Evidence: screenshot + Supabase session active.
- **rule TR-2.3:** Clicking Logout button → back to `/login`, cleared session.
- **rubric TR-2.4:** Login/Sidebar visual fidelity (0-5). ≥4 required. Scale matches Rubric AC-9. Evidence: screenshot vs `login-page.png`.

**Dependencies:** Task 1.

---

## Task 3: Business logic layer — compute everything from raw data

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-8.1–FR-8.9, AC-2, AC-5, AC-6, AC-10

### Work
`src/lib/business.js` + `src/hooks/useAppData.js`:
- `fetchAllPaginated(supabase, table)` — pages in 1000s to avoid truncation (FR-8.8).
- IST-date helpers (`todayIST()`, `inRange(dateStr, period)`) for filtering.
- `computeBuyerBalances(buyers, buyerSales, payments)` → per-buyer `{total_sales, total_paid, balance_due, sales_count, payments_count}` and aggregate `outstanding_total, outstanding_count, cleared_count`.
- `computeProductRevenue(buyerSales, retailSales)` → ranked product list.
- `todayFigures(buyerSales, retailSales, payments)` → 4 today cards.
- `buildRecentActivity(buyerSales, payments, limit=8)` → merged chronological rows with type.
- `currencyINR(n)` → `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`.
- `getInitialsColor(name)` → deterministic color from a palette of 8 for 2-letter initials avatar.
- Offline fallback loader: If initial Supabase select fails > 5s or network error, read from `new_recovery/06_raw_backup/` via json fetch (import) in read-only mode.

### Test Requirements

- **rule TR-3.1:** `computeBuyerBalances` for Gayathri with existing raw backup data returns balance 38,60,830 (same as OVERVIEW.json / live site). Evidence: console.log comparison value.
- **rule TR-3.2:** Outstanding count = 18 buyers, cleared = 7, total outstanding ₹55,59,281 (or exact live value).
- **rule TR-3.3:** Paginated fetch returns >1000 rows for `buyer_sales` table (there are 1436 entries) without truncation. Evidence: length logged.
- **rule TR-3.4:** `todayFigures()` with 0 rows today returns ₹0 across cards (not undefined/NaN).
- **rubric TR-3.5:** Computed numbers vs [OVERVIEW.json](file:///d:/gsm-recovery/new_recovery/05_reports/OVERVIEW.json) and live dashboard screenshot. 0-5 scale (≥4 required). 5 = every figure exact, 4 = 1 minor discrepancy <1%.

**Dependencies:** Task 1 (supabase client setup).

---

## Task 4: Dashboard page

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-2.1–FR-2.6, AC-2, AC-9

### Work
`src/pages/Dashboard.jsx` — pixel-perfect dashboard:
- Header row ("GSM Traders" + "Ukkadam Market, Coimbatore").
- Hero balance-due big card.
- 4 metric cards in responsive grid with correct icon badges.
- 2 quick-action tiles (Buyer Sale/Payment navy, Retail Sale purple), both `<Link>` navigations.
- "Top Outstanding Buyers" card (top 5, clickable → `/buyers/:id`).
- "Recent Activity" card with refresh icon, 8 merged rows, bottom "View full reports →".

### Test Requirements

- **rule TR-4.1:** Dashboard renders without crash + Hero amount == computed outstanding_total.
- **rule TR-4.2:** Top 5 outstanding buyers in correct order sorted by balance_due DESC (Gayathri first, Ramdas second, hsn third, etc).
- **rule TR-4.3:** Clicking quick-action Buyer Sale/Payment tile navigates to `/buyers`; Retail navigates to `/retail`.
- **rubric TR-4.4:** Visual fidelity vs [dashboard-full.png](file:///d:/gsm-recovery/dashboard) (0-5, ≥4 required).

**Dependencies:** Tasks 2 + 3.

---

## Task 5: Buyers list page + Add Buyer modal

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-3.1–FR-3.6, AC-4, AC-8

### Work
`src/pages/Buyers.jsx`:
- Header with count + Add Buyer dark pill button.
- 4 summary cards (buyers / outstanding / pending / cleared).
- Full-width search input (magnifier icon).
- 4 filter pills + SORT dropdown with 3 options.
- 2-col responsive buyer card grid (card with initials, name, phone, balance/clear badge, chevron → detail).
- Modal component `src/components/Modal.jsx`: generic dark-backdrop, close-X, rounded-2xl white centered panel.
- `src/components/AddBuyerModal.jsx`: 3 fields (Name required, Phone +91 input, Address textarea). On submit → insert Supabase → refresh list → optimistic update.

### Test Requirements

- **rule TR-5.1:** Filter pills toggle: clicking "Outstanding" shows only buyers with balance > 0, clicking "Cleared" shows 7 buyers, "High Due > 10k" matches filter. Evidence: screenshot after each click.
- **rule TR-5.2:** Sort dropdown "Name A–Z" reorders cards alphabetically; "Lowest Due" orders 1st entry the lowest balance.
- **rule TR-5.3:** Add buyer "ModalTest" name + empty phone → new buyer appears at correct alphabetical position with CLEARED badge (balance 0). Data inserted to Supabase buyers table.
- **rubric TR-5.4:** Visual fidelity vs [buyers-page-full.png](file:///d:/gsm-recovery/buyers-page-full) (0-5, ≥4 required).

**Dependencies:** Tasks 2 + 3.

---

## Task 6: Buyer detail page + Record Sale & Record Payment modals

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-4.1–FR-4.6, AC-5, AC-6

### Work
`src/pages/BuyerDetail.jsx` (dynamic param `/buyers/:id`, 404 if unknown):
- Back arrow, avatar big circle, name, phone, Edit button, Last Purchase + Last Payment metadata line.
- Big balance due hero card: billed / received 2-col split below.
- 3 action pill buttons (Record Sale dark, Record Payment green, Invoice outline stub with toast).
- Segmented Tabs: Sales / Payments toggle.
- Period pills row (This Week / This Month / 3 Months / All). Filtered list renders accordingly.
- Modals:
  - `RecordSaleModal.jsx`: Product dropdown (active only), mootais number, price_per_mootai number, sale_date default today IST, notes optional. On save: inserts to buyer_sales; optimistic UI updates balance and recent activity.
  - `RecordPaymentModal.jsx`: Amount paid, paid_at date today, notes. Inserts buyer_payments; update balance. If balance → 0: buyer card flips badge to "Clear ✓".

### Test Requirements

- **rule TR-6.1:** Record Sale (Malli, q=10, rate=100) → balance increases by exactly ₹1,000 and new row at top of Sales list in page. Evidence: before/after UI snapshot.
- **rule TR-6.2:** Record Payment (exact amount owed by a 0-near buyer, e.g., add buyer TestPay, add Sale 500, Payment 500 → CLEARED badge after refresh).
- **rule TR-6.3:** Tabs Sales/Payment toggle filter rows without crash. Period filter "This Week" shows only sales within the current ISO week.

**Dependencies:** Tasks 2 + 3 + 5 (Modal component).

---

## Task 7: Retail Sales page + Record Sale modal

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-5.1–FR-5.4

### Work
`src/pages/Retail.jsx`:
- Header + refresh circular-icon button + dark pill "+ Record Sale".
- Summary header card: "All-time Revenue" with big ₹ + sales count.
- Period pills (This Week / This Month / All or 4 variants matching snapshot).
- Sorted DESC date list of retail entries: each row with emoji+product, date, mootais, rate, total.
- `RecordRetailSaleModal.jsx`: product dropdown (only active), mootais_sold, price_per_mootai, sale_date default today, notes. Insert → retail_sales table; optimistic UI adds row at top.

### Test Requirements

- **rule TR-7.1:** Record a retail sale (Pudina, 50 mootais, 20 rate → 1000) → adds to list, All-time Revenue card sum increases by 1000 exactly.
- **rule TR-7.2:** Period "This Month" shows only entries within calendar month (IST-based date from retail_sales.sale_date).

**Dependencies:** Tasks 2 + 3 + 5 (Modal component).

---

## Task 8: Reports page — cards + bar chart + product ranking

**Priority:** `high`
**Status:** `pending`
**Covers:** FR-6.1–FR-6.4, AC-3, AC-7

### Work
`src/pages/Reports.jsx`:
- Period pills (This Week / This Month / 3 Months / All Time) — All Time selected default to show data in screenshots.
- 3 summary cards (Total green / Buyers navy / Retail purple).
- 2-col grid left Buyer-vs-Retail **bar chart** (no heavy chart lib — pure SVG div bars, gridlines, axis labels, legend). X-axis date labels at correct period granularity (month/week/day bins depending on range). Y-axis in "₹Xk" format, green bar = buyers, short purple bar = retail stacked or grouped side-by-side.
- Right: Sales By Product ranked list (Malli first, Pudina second, Karuvepillai third — matching screenshot).
- Below full-width: "Top Buyers" ranked list for the period.

### Test Requirements

- **rule TR-8.1:** All Time → TOTAL = BUYERS + RETAIL exactly (₹62,66,801 + ₹64,635 = ₹63,31,436 or matching live numbers).
- **rule TR-8.2:** "This Week" when there are 0 entries correctly shows ₹0 everywhere and "No data" placeholders (not crash/NaN).
- **rubric TR-8.3:** Reports visual fidelity vs [reports-full.png](file:///d:/gsm-recovery/reports) (0-5, ≥4 required). Especially: bar chart heights relative scale for July 2026 peak must proportionally match screenshot.

**Dependencies:** Tasks 2 + 3.

---

## Task 9: Products Master page — accordion list + edit

**Priority:** `medium`
**Status:** `pending`
**Covers:** FR-7.1–FR-7.3

### Work
`src/pages/Products.jsx`:
- Page header / subtitle count / +Add button / description paragraph.
- Accordion list sorted by sort_order ascending. Each row: emoji colored rounded bg, product name, "Primary" green badge (for active top products) / "Occasional" grey (for inactive/others), expand chevron-down toggle.
- Expanded panel: Emoji input/picker (simple emoji or text emoji), Name text, Active toggle switch (on/off), Sort Order number input, Save + Cancel buttons.
- Save → update Supabase products row `{ name, emoji, active, sort_order }` (no insert of id, use existing).

### Test Requirements

- **rule TR-9.1:** Accordion opens/closes on click without crash. Products in correct order: Pudina (order 1) first, Malli 2, Karuvepillai 3, poondu 4.
- **rule TR-9.2:** Toggle Active off for Pudina → after save, it stops appearing in Record Sale product dropdowns (but remains on past records). Turn on again → appears.
- **rubric TR-9.3:** Visual fidelity vs products screenshot (0-5, ≥4 required).

**Dependencies:** Tasks 2 + 3 + 5.

---

## Task 10: Mobile responsiveness + polish + offline banner + dev/build verification

**Priority:** `medium`
**Status:** `pending`
**Covers:** NFR-2, NFR-5, NFR-6, AC-9

### Work
- Ensure <1024px sidebar collapses to hamburger → drawer mobile. All pages responsive: grids collapse to 1-col on phones; cards fit viewport; no horizontal scrollbars.
- Add persistent small orange banner at top when offline fallback data is loaded, explaining demo mode.
- Add lucide-react icon library for consistent icons (LayoutDashboard, Users, Store, BarChart3, Package, LogOut, Search, RefreshCcw, Plus, ArrowLeft, Edit3, FileText, ChevronRight, ChevronDown, Eye, EyeOff, Phone, MapPin, AlertTriangle, Check).
- Loading skeletons for dashboard cards while data fetches.
- Error toast (simple no lib) for failed inserts.
- Run `npm run build` → clean `dist/` output with 0 errors.
- Final screenshot pass of every page against the reference screenshots.

### Test Requirements

- **rule TR-10.1:** `npm run build` exits with code 0, no warnings. Evidence: terminal output.
- **rule TR-10.2:** DevTools responsive device mode (iPhone width 390px): pages render without horizontal scroll; sidebar turns into drawer; drawer opens on hamburger tap.
- **rubric TR-10.3:** Overall polish & smoothness (0-5, ≥4 required). 5 = buttery, loading states everywhere, no empty areas while loading. 4 = very smooth minor 1-2 polish gaps.

**Dependencies:** Tasks 4–9 inclusive.

---

## Task 11 (Optional / User Decision): Suppliers page / Edit buyer / Invoice stub

**Priority:** `low`
**Status:** `pending` (candidate for cancellation unless user wants; currently outside scope since sidebar doesn't show Suppliers on live site).

- Add if user approves. Covers: Open Question in spec.

---

# Coverage Map to ACs

| AC | Covered primarily by tasks |
|---|---|
| AC-1 | Task 2 |
| AC-2 | Tasks 3 + 4 |
| AC-3 | Tasks 4 + 8 |
| AC-4 | Task 5 |
| AC-5 | Task 6 |
| AC-6 | Task 6 |
| AC-7 | Tasks 3 + 8 |
| AC-8 | Task 5 |
| AC-9 | Tasks 2, 4, 5, 8, 9, 10 (each with rubric ≥4) |
| AC-10 | Task 3 (TR-3.5) |
