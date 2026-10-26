const INDIAN_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LEGACY_SALE_UNIT_CUTOFF = '2026-10-15';

const CURRENCY_FMT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function currencyINR(n) {
  const v = n == null || Number.isNaN(Number(n)) ? 0 : Number(n);
  return CURRENCY_FMT.format(Math.round(v));
}

export function currencyINRPerUnit(n) {
  const value = Number(n || 0);
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 6 })}`;
}

export function productSalesUnit(product) {
  const name = String(product?.name || '').trim().toLocaleLowerCase();
  const productUnits = {
    malli: { salesUnit: 'Kattu', stockUnit: 'Mootai', factor: 50 },
    pudina: { salesUnit: 'Kattu', stockUnit: 'Mootai', factor: 200 },
    karuvepillai: { salesUnit: 'Kg', stockUnit: 'Kg', factor: 1 },
  };
  const standard = productUnits[name];
  if (standard) return standard.salesUnit;
  return String(product?.sales_unit || 'Mootai').trim() || 'Mootai';
}

export function isRemovedProductName(name) {
  return ['puundu', 'poondu'].includes(String(name || '').trim().toLocaleLowerCase());
}

export function productStockUnit(product) {
  const name = String(product?.name || '').trim().toLocaleLowerCase();
  const standard = { malli: 'Mootai', pudina: 'Mootai', karuvepillai: 'Kg' }[name];
  return standard || String(product?.stock_entry_unit || productSalesUnit(product)).trim() || productSalesUnit(product);
}

export function productStockToSalesFactor(product) {
  const name = String(product?.name || '').trim().toLocaleLowerCase();
  const standard = { malli: 50, pudina: 200, karuvepillai: 1 }[name];
  if (standard) return standard;
  const factor = Number(product?.stock_to_sales_factor ?? 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function saleQuantityUnit(sale) {
  const storedUnit = String(sale?.quantity_unit || '').trim();
  if (storedUnit) return storedUnit;
  const name = String(sale?.product || '').trim().toLocaleLowerCase();
  const stockUnit = productStockUnit({ name });
  const saleDate = String(sale?.sale_date || '').slice(0, 10);
  return saleDate && saleDate < '2026-10-13'
    ? stockUnit
    : productSalesUnit({ name });
}

function saleQuantityInSalesUnit(sale, product) {
  const quantity = Number(sale?.mootais ?? sale?.mootais_sold ?? 0);
  const storedUnit = saleQuantityUnit(sale);
  if (storedUnit === productSalesUnit(product)) return quantity;
  if (storedUnit === productStockUnit(product)) {
    return quantity * productStockToSalesFactor(product);
  }
  return quantity;
}

export function saleInputUnits(product) {
  const salesUnit = productSalesUnit(product);
  const stockUnit = productStockUnit(product);
  return salesUnit === stockUnit || productStockToSalesFactor(product) === 1
    ? [salesUnit]
    : [stockUnit, salesUnit];
}

export function stockQuantityInputUnits(product) {
  const units = [...new Set([productSalesUnit(product), productStockUnit(product)])];
  if (String(product?.name || '').trim().toLocaleLowerCase() === 'malli') units.push('Kg');
  return units;
}

export function normalizeStockQuantityInput(product, quantity, unit, unitCost) {
  const value = Number(quantity);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Enter a valid non-negative stock count.');
  }

  const salesUnit = productSalesUnit(product);
  const stockUnit = productStockUnit(product);
  const factor = productStockToSalesFactor(product);
  let salesUnitFactor;
  if (unit === salesUnit) salesUnitFactor = 1;
  else if (unit === stockUnit) salesUnitFactor = factor;
  else if (unit === 'Kg' && String(product?.name || '').trim().toLocaleLowerCase() === 'malli') {
    salesUnitFactor = 50 / 35;
  } else {
    throw new Error('Choose a valid unit for the physical stock count.');
  }

  const cost = unitCost == null || unitCost === '' ? null : Number(unitCost);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) {
    throw new Error('Enter a valid non-negative estimated unit cost.');
  }
  return {
    quantity: value * salesUnitFactor,
    unitCost: cost == null
      ? null
      : unit === 'Kg' && String(product?.name || '').trim().toLocaleLowerCase() === 'malli'
        ? cost * (35 / 50)
        : cost / salesUnitFactor,
  };
}

export function normalizeSaleInput(product, quantity, rate, inputUnit) {
  const value = Number(quantity);
  const unitRate = Number(rate);
  const salesUnit = productSalesUnit(product);
  const stockUnit = productStockUnit(product);
  if (inputUnit !== salesUnit && inputUnit !== stockUnit) {
    throw new Error('Choose a valid sale unit for this product.');
  }
  const factor = inputUnit === stockUnit ? productStockToSalesFactor(product) : 1;
  return {
    quantity: value * factor,
    rate: unitRate / factor,
  };
}

export function saleQuantityInUnit(product, quantity, inputUnit, targetUnit) {
  const salesQuantity = normalizeSaleInput(product, quantity, 0, inputUnit).quantity;
  const factor = productStockToSalesFactor(product);
  return targetUnit === productStockUnit(product) ? salesQuantity / factor : salesQuantity;
}

export function saleRateInUnit(product, rate, inputUnit, targetUnit) {
  const salesRate = normalizeSaleInput(product, 0, rate, inputUnit).rate;
  const factor = productStockToSalesFactor(product);
  return targetUnit === productStockUnit(product) ? salesRate * factor : salesRate;
}

export function malliKgEquivalent(product, quantity, unit) {
  if (String(product?.name || '').trim().toLocaleLowerCase() !== 'malli') return null;
  const value = Number(quantity);
  if (!Number.isFinite(value)) return null;
  if (unit === 'Kg') return value;
  if (unit === 'Mootai') return value * 35;
  if (unit === 'Kattu') return value * 35 / 50;
  return null;
}

export function formatMalliKgEquivalent(product, quantity, unit) {
  const kg = malliKgEquivalent(product, quantity, unit);
  return kg == null ? '' : `${formatQuantity(kg)} Kg`;
}

function findSaleProduct(sale, products = []) {
  const productName = String(sale?.product || '').trim().toLocaleLowerCase();
  return products.find((item) => String(item.name || '').trim().toLocaleLowerCase() === productName)
    || { name: sale?.product };
}

export function productQuantitiesByUnit(product, salesQuantity) {
  const quantity = Number(salesQuantity);
  const salesUnit = productSalesUnit(product);
  const stockUnit = productStockUnit(product);
  const factor = productStockToSalesFactor(product);
  const quantities = stockUnit === salesUnit || factor === 1
    ? { [salesUnit]: quantity }
    : { [stockUnit]: quantity / factor, [salesUnit]: quantity };
  const kg = malliKgEquivalent(product, quantity, salesUnit);
  if (kg != null) quantities.Kg = kg;
  return quantities;
}

export function formatProductQuantities(product, salesQuantity) {
  return Object.entries(productQuantitiesByUnit(product, salesQuantity))
    .map(([unit, quantity]) => `${formatQuantity(quantity)} ${unit}`)
    .join(' / ');
}

export function formatSalesQuantityForDate(product, salesQuantity, date) {
  if (date && date <= LEGACY_SALE_UNIT_CUTOFF) {
    const stockUnit = productStockUnit(product);
    if (stockUnit !== productSalesUnit(product)) {
      const legacyQuantity = Number(salesQuantity || 0) / productStockToSalesFactor(product);
      const kg = malliKgEquivalent(product, salesQuantity, productSalesUnit(product));
      return [
        `${formatQuantity(legacyQuantity)} ${stockUnit}`,
        kg == null ? '' : `${formatQuantity(kg)} Kg`,
      ].filter(Boolean).join(' / ');
    }
  }
  return formatProductQuantities(product, salesQuantity);
}

export function movementQuantityInSalesUnits(movement, product, sale, products = []) {
  const quantity = Number(movement?.quantity_delta || 0);
  if (sale) {
    const salesQuantity = saleQuantityInSalesUnit(sale, findSaleProduct(sale, products));
    return Math.sign(quantity) * salesQuantity;
  }

  const movementUnit = String(movement?.quantity_unit || '').trim();
  if (movementUnit === productStockUnit(product) && movementUnit !== productSalesUnit(product)) {
    return quantity * productStockToSalesFactor(product);
  }
  return quantity;
}

export function formatMovementQuantities(movement, product, sale, products = []) {
  if (sale) {
    const direction = Math.sign(Number(movement?.quantity_delta || 0));
    return Object.entries(saleQuantitiesByUnit(sale, products))
      .map(([unit, quantity]) => `${formatQuantity(direction * quantity)} ${unit}`)
      .join(' / ');
  }
  return formatProductQuantities(
    product,
    movementQuantityInSalesUnits(movement, product, sale, products)
  );
}

export function saleQuantitiesByUnit(sale, products = []) {
  const product = findSaleProduct(sale, products);
  const salesQuantity = saleQuantityInSalesUnit(sale, product);
  const saleDate = String(sale?.sale_date || '').slice(0, 10);
  if (saleDate && saleDate <= LEGACY_SALE_UNIT_CUTOFF) {
    const stockUnit = productStockUnit(product);
    if (stockUnit !== productSalesUnit(product)) {
      const quantities = {
        [stockUnit]: salesQuantity / productStockToSalesFactor(product),
      };
      const kg = malliKgEquivalent(product, salesQuantity, productSalesUnit(product));
      if (kg != null) quantities.Kg = kg;
      return quantities;
    }
  }
  return productQuantitiesByUnit(product, salesQuantity);
}

export function formatSaleQuantities(sale, products = []) {
  return Object.entries(saleQuantitiesByUnit(sale, products))
    .map(([unit, quantity]) => `${formatQuantity(quantity)} ${unit}`)
    .join(' / ');
}

export function formatSaleRates(sale, products = []) {
  const amount = Number(sale?.mootais ?? sale?.mootais_sold ?? 0)
    * Number(sale?.price_per_mootai ?? 0);
  return Object.entries(saleQuantitiesByUnit(sale, products))
    .map(([unit, quantity]) => `${currencyINRPerUnit(quantity === 0 ? 0 : amount / quantity)} per ${unit}`)
    .join(' / ');
}

export function formatQuantity(value) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function formatQuantityByUnit(quantities) {
  return Object.entries(quantities || {})
    .filter(([, quantity]) => Number(quantity) !== 0)
    .map(([unit, quantity]) => `${formatQuantity(quantity)} ${unit}`)
    .join(' / ');
}

function addQuantityByUnit(target, unit, quantity) {
  const key = unit || 'Mootai';
  target[key] = (target[key] || 0) + Number(quantity || 0);
}

export function formatDateCompact(iso) {
  if (!iso) return '—';
  const d = parseDateStr(iso);
  if (!d || Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseDateStr(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const first = String(s).slice(0, 10);
  const [y, m, d] = first.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0);
}

export function toISTDateKey(date = new Date()) {
  const ist = new Date(date.getTime() + INDIAN_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function realTodayIST() {
  return toISTDateKey(new Date());
}

export function dataRefDate(...dateLists) {
  let latest = null;
  for (const list of dateLists) {
    for (const row of list || []) {
      for (const f of ['sale_date', 'paid_at', 'created_at']) {
        const key = row && row[f] ? String(row[f]).slice(0, 10) : null;
        if (key && key >= '2000-01-01' && (!latest || key > latest)) latest = key;
      }
    }
  }
  return latest || realTodayIST();
}

let dashboardRefToday = realTodayIST();
let reportsRefToday = realTodayIST();

export function setRefToday(value) {
  dashboardRefToday = value || realTodayIST();
  reportsRefToday = realTodayIST();
  return { dashboard: dashboardRefToday, reports: reportsRefToday };
}

export function todayIST(scope = 'reports') {
  if (scope === 'dashboard') return dashboardRefToday;
  return reportsRefToday;
}

export function startOfWeekIST(scope = 'reports') {
  const d = parseDateStr(todayIST(scope));
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return toISTDateKey(d);
}

export function startOfMonthIST(scope = 'reports') {
  const k = todayIST(scope);
  return k.slice(0, 7) + '-01';
}

export function startOfThreeMonthsAgo(scope = 'reports') {
  const d = parseDateStr(todayIST(scope));
  d.setMonth(d.getMonth() - 3);
  return toISTDateKey(d);
}

export function inPeriod(dateStr, period, scope = 'reports') {
  const key = dateStr ? String(dateStr).slice(0, 10) : null;
  if (!key) return false;
  const today = todayIST(scope);
  if (key > today) return false;
  if (period === 'all' || !period) return true;
  if (period === 'today') return key === today;
  if (period === 'week') return key >= startOfWeekIST(scope);
  if (period === 'month') return key >= startOfMonthIST(scope);
  if (period === '3months') return key >= startOfThreeMonthsAgo(scope);
  return true;
}

export function computeInventoryCostReport(movements, buyerSales, retailSales, period, totalRevenue) {
  const inPeriodMovements = (movements || []).filter((movement) => (
    inPeriod(movement.movement_date, period, 'reports')
  ));
  const salesById = new Map();
  for (const sale of buyerSales || []) {
    salesById.set(`buyer_sales:${sale.id}`, Number(sale.mootais || 0) * Number(sale.price_per_mootai || 0));
  }
  for (const sale of retailSales || []) {
    salesById.set(`retail_sales:${sale.id}`, Number(sale.mootais_sold || 0) * Number(sale.price_per_mootai || 0));
  }

  let receiptCost = 0;
  let spoilageCost = 0;
  let trackedSaleCost = 0;
  let trackedSaleRevenue = 0;
  let trackedSalesCount = 0;
  const stockBalances = new Map();
  for (const movement of inPeriodMovements) {
    const cost = Number(movement.cost_delta || 0);
    if (movement.movement_type === 'receipt') receiptCost += cost;
    if (movement.movement_type === 'spoilage') spoilageCost -= cost;
    if (movement.movement_type === 'sale') {
      const source = `${movement.source_kind}:${movement.source_id}`;
      if (salesById.has(source)) {
        trackedSaleCost -= cost;
        trackedSaleRevenue += salesById.get(source);
        trackedSalesCount += 1;
      }
    }
  }
  for (const movement of movements || []) {
    if (String(movement.movement_date || '').slice(0, 10) > todayIST('reports')) continue;
    stockBalances.set(
      movement.product_id,
      (stockBalances.get(movement.product_id) || 0) + Number(movement.quantity_delta || 0),
    );
  }
  const stockShortage = Array.from(stockBalances.values()).some((quantity) => quantity < 0);

  return {
    receiptCost,
    spoilageCost,
    trackedSaleCost,
    trackedSaleRevenue,
    trackedSalesCount,
    trackedGrossProfit: stockShortage ? null : trackedSaleRevenue - trackedSaleCost,
    tradingProfit: stockShortage ? null : trackedSaleRevenue - trackedSaleCost - spoilageCost,
    stockShortage,
    trackedRevenueCoverage: totalRevenue > 0
      ? Math.min(100, (trackedSaleRevenue / totalRevenue) * 100)
      : 0,
  };
}

export function computeDailyProductProfits(settings, movements, products, buyerSales, retailSales, date) {
  const productsById = new Map((products || []).map((product) => [product.id, product]));
  const salesBySource = new Map();
  const salesByProduct = new Map();
  const addSale = (sale, sourceKind, quantity, price) => {
    if (String(sale.sale_date || '').slice(0, 10) !== date) return;
    const productName = String(sale.product || '').trim().toLocaleLowerCase();
    const revenue = Number(quantity || 0) * Number(price || 0);
    const sales = salesByProduct.get(productName) || {
      revenue: 0,
      buyerRevenue: 0,
      retailRevenue: 0,
      salesCount: 0,
    };
    sales.revenue += revenue;
    if (sourceKind === 'buyer_sales') sales.buyerRevenue += revenue;
    else sales.retailRevenue += revenue;
    sales.salesCount += 1;
    salesByProduct.set(productName, sales);
    salesBySource.set(`${sourceKind}:${sale.id}`, { productName, revenue, sourceKind });
  };
  for (const sale of buyerSales || []) {
    addSale(sale, 'buyer_sales', sale.mootais, sale.price_per_mootai);
  }
  for (const sale of retailSales || []) {
    addSale(sale, 'retail_sales', sale.mootais_sold, sale.price_per_mootai);
  }

  const productCosts = new Map();
  for (const setting of settings || []) {
    const product = productsById.get(setting.product_id);
    if (!product) continue;
    productCosts.set(setting.product_id, {
      product,
      revenue: salesByProduct.get(String(product.name || '').trim().toLocaleLowerCase())?.revenue || 0,
      buyerRevenue: salesByProduct.get(String(product.name || '').trim().toLocaleLowerCase())?.buyerRevenue || 0,
      retailRevenue: salesByProduct.get(String(product.name || '').trim().toLocaleLowerCase())?.retailRevenue || 0,
      salesCount: salesByProduct.get(String(product.name || '').trim().toLocaleLowerCase())?.salesCount || 0,
      saleCost: 0,
      buyerSaleCost: 0,
      retailSaleCost: 0,
      costedSalesCount: 0,
      damageCost: 0,
      stockBalance: 0,
    });
  }

  for (const movement of movements || []) {
    if (movement.movement_date !== date) continue;
    const costs = productCosts.get(movement.product_id);
    if (!costs) continue;
    costs.stockBalance += Number(movement.quantity_delta || 0);
    if (movement.movement_type === 'sale') {
      const sale = salesBySource.get(`${movement.source_kind}:${movement.source_id}`);
      if (sale && sale.productName === String(costs.product.name || '').trim().toLocaleLowerCase()) {
        const saleCost = -Number(movement.cost_delta || 0);
        costs.saleCost += saleCost;
        if (sale.sourceKind === 'buyer_sales') costs.buyerSaleCost += saleCost;
        else costs.retailSaleCost += saleCost;
        costs.costedSalesCount += 1;
      }
    } else if (movement.movement_type === 'spoilage') {
      costs.damageCost -= Number(movement.cost_delta || 0);
    }
  }

  return new Map(Array.from(productCosts.entries()).map(([productId, costs]) => {
    const costsComplete = costs.costedSalesCount >= costs.salesCount;
    const stockBalance = Math.round(costs.stockBalance * 1000) / 1000;
    const stockShortage = stockBalance < 0;
    return [productId, {
      ...costs,
      stockBalance,
      buyerProfit: costs.buyerRevenue - costs.buyerSaleCost,
      retailProfit: costs.retailRevenue - costs.retailSaleCost,
      finalProfit: costsComplete && !stockShortage
        ? costs.revenue - costs.saleCost - costs.damageCost
        : null,
      costsComplete,
      stockShortage,
    }];
  }));
}

export function buildDailyStockClosingRows(settings, movements, counts, products, date) {
  const productsById = new Map((products || []).map((product) => [product.id, product]));
  const countsByProduct = new Map(
    (counts || []).filter((count) => count.stock_date === date).map((count) => [count.product_id, count])
  );
  return (settings || []).map((setting) => {
    const product = productsById.get(setting.product_id);
    const todaysMovements = (movements || []).filter(
      (movement) => movement.product_id === setting.product_id && movement.movement_date === date
    );
    const quantityOf = (predicate, sign = 1) => todaysMovements
      .filter(predicate)
      .reduce((sum, movement) => sum + sign * Number(movement.quantity_delta || 0), 0);
    const opening = quantityOf((movement) => movement.movement_type === 'opening');
    const buyerSold = quantityOf(
      (movement) => movement.movement_type === 'sale' && movement.source_kind === 'buyer_sales',
      -1
    );
    const retailSold = quantityOf(
      (movement) => movement.movement_type === 'sale' && movement.source_kind === 'retail_sales',
      -1
    );
    const count = countsByProduct.get(setting.product_id);
    return {
      productId: setting.product_id,
      product,
      productName: product?.name || 'Unknown product',
      unit: productSalesUnit(product),
      opening,
      receipts: quantityOf((movement) => movement.movement_type === 'receipt'),
      buyerSold,
      retailSold,
      sold: buyerSold + retailSold,
      damaged: quantityOf((movement) => movement.movement_type === 'spoilage', -1),
      countVariance: quantityOf((movement) => movement.movement_type === 'count_adjustment'),
      corrections: quantityOf((movement) => movement.movement_type === 'correction'),
      closing: todaysMovements.reduce((sum, movement) => sum + Number(movement.quantity_delta || 0), 0),
      countedQuantity: count?.counted_quantity ?? null,
      countRecorded: !!count,
    };
  }).sort((a, b) => a.productName.localeCompare(b.productName));
}

export function buildProductPerformance(buyerSales, retailSales, movements, productCatalog = []) {
  const productNamesById = new Map(productCatalog.map((product) => [product.id, product.name]));
  const products = new Map();
  const getProduct = (name) => {
    const productName = name || '(Unknown)';
    if (!products.has(productName)) {
      products.set(productName, {
        product: productName,
        wholesale_quantities: {},
        wholesale_revenue: 0,
        retail_quantities: {},
        retail_revenue: 0,
        tracked_revenue: 0,
        stock_cost: 0,
        spoilage_cost: 0,
        tracked_sales: 0,
      });
    }
    return products.get(productName);
  };
  const salesById = new Map();

  for (const sale of buyerSales || []) {
    const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
    const revenue = quantity * Number(sale.price_per_mootai || 0);
    const row = getProduct(sale.product);
    for (const [unit, value] of Object.entries(saleQuantitiesByUnit(sale, productCatalog))) {
      addQuantityByUnit(row.wholesale_quantities, unit, value);
    }
    row.wholesale_revenue += revenue;
    salesById.set(`buyer_sales:${sale.id}`, { row, revenue });
  }
  for (const sale of retailSales || []) {
    const quantity = Number(sale.mootais_sold ?? sale.mootais ?? 0);
    const revenue = quantity * Number(sale.price_per_mootai || 0);
    const row = getProduct(sale.product);
    for (const [unit, value] of Object.entries(saleQuantitiesByUnit(sale, productCatalog))) {
      addQuantityByUnit(row.retail_quantities, unit, value);
    }
    row.retail_revenue += revenue;
    salesById.set(`retail_sales:${sale.id}`, { row, revenue });
  }
  for (const movement of movements || []) {
    const row = getProduct(movement.product_name || productNamesById.get(movement.product_id));
    const cost = Number(movement.cost_delta || 0);
    if (movement.movement_type === 'sale') {
      const sale = salesById.get(`${movement.source_kind}:${movement.source_id}`);
      if (!sale) continue;
      sale.row.tracked_revenue += sale.revenue;
      sale.row.stock_cost -= cost;
      sale.row.tracked_sales += 1;
    }
    if (movement.movement_type === 'spoilage') row.spoilage_cost -= cost;
  }
  for (const movement of movements || []) {
    if (String(movement.movement_date || '').slice(0, 10) > todayIST('reports')) continue;
    const row = getProduct(movement.product_name || productNamesById.get(movement.product_id));
    row.stock_balance = Number(row.stock_balance || 0) + Number(movement.quantity_delta || 0);
  }

  return Array.from(products.values())
    .map((row) => ({
      ...row,
      stock_shortage: Number(row.stock_balance || 0) < 0,
      trading_profit: row.tracked_sales && Number(row.stock_balance || 0) >= 0
        ? row.tracked_revenue - row.stock_cost - row.spoilage_cost
        : null,
    }))
    .sort((a, b) => (b.wholesale_revenue + b.retail_revenue) - (a.wholesale_revenue + a.retail_revenue));
}

export function buildWhatsAppBillUrl(buyer, balance, buyerSales, buyerPayments) {
  if (!buyer?.phone) return null;
  let phone = String(buyer.phone).replace(/\D/g, '');
  if (phone.startsWith('0') && phone.length === 11) phone = phone.slice(1);
  if (phone.length === 10) phone = `91${phone}`;
  if (phone.length < 11 || phone.length > 15) return null;

  const monthly = new Map();
  for (const sale of buyerSales || []) {
    if (sale.buyer_id !== buyer.id || !sale.sale_date) continue;
    const month = String(sale.sale_date).slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, { quantities: {}, billed: 0, paid: 0 });
    const row = monthly.get(month);
    const quantity = Number(sale.mootais ?? sale.mootais_sold ?? 0);
    for (const [unit, value] of Object.entries(saleQuantitiesByUnit(sale))) {
      addQuantityByUnit(row.quantities, unit, value);
    }
    row.billed += quantity * Number(sale.price_per_mootai || 0);
  }
  for (const payment of buyerPayments || []) {
    if (payment.buyer_id !== buyer.id || !payment.paid_at) continue;
    const month = String(payment.paid_at).slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, { quantities: {}, billed: 0, paid: 0 });
    monthly.get(month).paid += Number(payment.amount_paid || 0);
  }
  const totalQuantities = {};
  for (const sale of buyerSales || []) {
    if (sale.buyer_id === buyer.id) {
      for (const [unit, value] of Object.entries(saleQuantitiesByUnit(sale))) {
        addQuantityByUnit(totalQuantities, unit, value);
      }
    }
  }

  const monthLines = Array.from(monthly.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 12)
    .reverse()
    .map(([month, amounts]) => (
      `${new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}: ${formatQuantityByUnit(amounts.quantities)} | billed INR ${Math.round(amounts.billed).toLocaleString('en-IN')} | paid INR ${Math.round(amounts.paid).toLocaleString('en-IN')}`
    ));
  const message = [
    `Hi ${buyer.name},`,
    'GSM Traders bill reminder:',
    '',
    ...(monthLines.length ? ['Monthly summary (latest 12 months):', ...monthLines, ''] : []),
    `Total quantity purchased: ${formatQuantityByUnit(totalQuantities)}`,
    `Total billed: INR ${Math.round(balance?.total_sales || 0).toLocaleString('en-IN')}`,
    `Total paid: INR ${Math.round(balance?.total_paid || 0).toLocaleString('en-IN')}`,
    `Amount pending: INR ${Math.round(balance?.balance_due || 0).toLocaleString('en-IN')}`,
    ...(balance?.credit_balance > 0
      ? [`Credit balance: INR ${Math.round(balance.credit_balance).toLocaleString('en-IN')}`]
      : []),
    '',
    'Please contact us if you have any questions. Thank you.',
  ].join('\n');

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

const AVATAR_PALETTE = [
  'bg-teal-500',
  'bg-[#0f3460]',
  'bg-indigo-600',
  'bg-red-600',
  'bg-purple-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-sky-700',
  'bg-pink-600',
  'bg-[#8200da]',
  'bg-green-700',
  'bg-blue-700',
];

export function stringHash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  const p0 = parts[0] || '';
  const p1 = parts[1] || '';
  return (p0[0] + (p1[0] || '')).toUpperCase();
}

export function getInitialsColor(name) {
  return AVATAR_PALETTE[stringHash(name) % AVATAR_PALETTE.length];
}

export function getProductEmoji(productName, products = []) {
  if (!productName) return '🌿';
  const match = products.find((p) => p.name === productName);
  if (match && match.emoji) return match.emoji;
  const map = {
    Malli: '🌼',
    Pudina: '🌿',
    Karuvepillai: '🍃',
  };
  return map[productName] || '🌱';
}

export async function fetchAllPaginated(sb, table, { orderCol = 'created_at', orderAsc = false, limit = 1000, columns = '*' } = {}) {
  let all = [];
  let from = 0;
  while (true) {
    const to = from + limit - 1;
    let q = sb.from(table).select(columns).range(from, to);
    if (orderCol) q = q.order(orderCol, { ascending: orderAsc });
    const { data, error } = await q;
    if (error) return { error, data: null };
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < limit) break;
    from += limit;
  }
  return { data: all, error: null };
}

export function computeBuyerBalances(buyers, buyerSales, buyerPayments) {
  const perBuyer = new Map();
  const out = {
    list: [],
    outstanding_total: 0,
    outstanding_count: 0,
    customer_credit_total: 0,
    customer_credit_count: 0,
    cleared_count: 0,
    total_sales: 0,
    total_payments: 0,
  };
  for (const b of buyers) {
    perBuyer.set(b.id, {
      id: b.id,
      name: b.name,
      phone: b.phone || '',
      address: b.address || '',
      buyer_obj: b,
      sales: [],
      payments: [],
      total_sales: 0,
      total_paid: 0,
      balance_due: 0,
      credit_balance: 0,
      sales_count: 0,
      payments_count: 0,
      last_purchase: null,
      last_payment: null,
    });
  }
  for (const s of buyerSales || []) {
    const qty = s.mootais ?? s.mootais_sold ?? 0;
    const rate = s.price_per_mootai ?? 0;
    const amt = Number(qty || 0) * Number(rate || 0);
    const entry = perBuyer.get(s.buyer_id);
    if (entry) {
      entry.sales.push(s);
      entry.total_sales += amt;
      entry.sales_count += 1;
      if (!entry.last_purchase || (s.sale_date && s.sale_date > entry.last_purchase)) {
        entry.last_purchase = s.sale_date || null;
      }
    }
    out.total_sales += amt;
  }
  for (const p of buyerPayments || []) {
    const entry = perBuyer.get(p.buyer_id);
    const amt = Number(p.amount_paid ?? 0);
    if (entry) {
      entry.payments.push(p);
      entry.total_paid += amt;
      entry.payments_count += 1;
      if (!entry.last_payment || (p.paid_at && p.paid_at > entry.last_payment)) {
        entry.last_payment = p.paid_at || null;
      }
    }
    out.total_payments += amt;
  }
  for (const b of buyers) {
    const e = perBuyer.get(b.id);
    e.balance_due = Math.max(0, e.total_sales - e.total_paid);
    e.credit_balance = Math.max(0, e.total_paid - e.total_sales);
    if (e.balance_due > 0) {
      out.outstanding_total += e.balance_due;
      out.outstanding_count += 1;
    } else {
      out.cleared_count += 1;
    }
    if (e.credit_balance > 0) {
      out.customer_credit_total += e.credit_balance;
      out.customer_credit_count += 1;
    }
    out.list.push(e);
  }
  out.list.sort((a, b) => b.balance_due - a.balance_due);
  return out;
}

export function computeProductRevenue(buyerSales, retailSales, productCatalog = []) {
  const agg = new Map();
  const bump = (productName, quantities, revenue) => {
    const k = productName || '(Unknown)';
    if (!agg.has(k)) agg.set(k, { product: k, total_quantities: {}, total_revenue: 0, sales_count: 0 });
    const e = agg.get(k);
    for (const [unit, quantity] of Object.entries(quantities)) {
      addQuantityByUnit(e.total_quantities, unit, quantity);
    }
    e.total_revenue += Number(revenue || 0);
    e.sales_count += 1;
  };
  for (const s of buyerSales || []) {
    const q = s.mootais ?? s.mootais_sold ?? 0;
    const r = s.price_per_mootai ?? 0;
    bump(s.product, saleQuantitiesByUnit(s, productCatalog), q * r);
  }
  for (const s of retailSales || []) {
    const q = s.mootais_sold ?? s.mootais ?? 0;
    const r = s.price_per_mootai ?? 0;
    bump(s.product, saleQuantitiesByUnit(s, productCatalog), q * r);
  }
  return Array.from(agg.values()).sort((a, b) => b.total_revenue - a.total_revenue);
}

export function todayFigures(buyerSales, retailSales, buyerPayments) {
  const today = todayIST('dashboard');
  let buyers = 0;
  let retail = 0;
  let collections = 0;
  for (const s of buyerSales || []) if ((s.sale_date || '').slice(0, 10) === today) buyers += (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0);
  for (const s of retailSales || []) if ((s.sale_date || '').slice(0, 10) === today) retail += (s.mootais_sold ?? s.mootais ?? 0) * (s.price_per_mootai ?? 0);
  for (const payment of buyerPayments || []) if ((payment.paid_at || '').slice(0, 10) === today) collections += Number(payment.amount_paid || 0);
  return { buyers, retail, collections, total: buyers + retail };
}

export function buildRecentActivity(buyerSales, payments, buyersById = {}, limit = 8, retailSales = []) {
  const rows = [];
  for (const s of buyerSales || []) {
    const buyer = buyersById[s.buyer_id];
    rows.push({
      ts: s.sale_date || s.created_at || '',
      type: 'SALE',
      id: s.id,
      product: s.product,
      buyer_name: buyer ? (buyer.archived_at ? 'Deleted user' : buyer.name) : '',
      buyer_id: s.buyer_id,
      amount: (s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0),
      date: s.sale_date || null,
      buyer,
      record: s,
    });
  }
  for (const p of payments || []) {
    const buyer = buyersById[p.buyer_id];
    rows.push({
      ts: p.paid_at || p.created_at || '',
      type: 'PAYMENT',
      id: p.id,
      product: null,
      buyer_name: buyer ? (buyer.archived_at ? 'Deleted user' : buyer.name) : '',
      buyer_id: p.buyer_id,
      amount: Number(p.amount_paid ?? 0),
      date: p.paid_at || null,
      buyer,
      record: p,
    });
  }
  for (const s of retailSales || []) {
    rows.push({
      ts: s.sale_date || s.created_at || '',
      type: 'RETAIL',
      id: s.id,
      product: s.product,
      buyer_name: '',
      buyer_id: null,
      amount: (s.mootais_sold ?? s.mootais ?? 0) * (s.price_per_mootai ?? 0),
      date: s.sale_date || null,
      buyer: null,
      record: s,
    });
  }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return rows.slice(0, limit);
}

export function buildMonthlyBuckets(buyerSales, retailSales, period, scope = 'dashboard') {
  const buckets = new Map();
  const ensure = (key) => {
    if (!buckets.has(key)) buckets.set(key, { key, buyers: 0, retail: 0 });
    return buckets.get(key);
  };
  const each = (arr, field, prop) => {
    for (const s of arr || []) {
      const ds = (s[field] || '').slice(0, 10);
      if (!inPeriod(ds, period, scope)) continue;
      const d = parseDateStr(ds);
      if (!d) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const labelShort = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const b = ensure(`${y}-${m}||${labelShort}`);
      const amt = ((s.mootais ?? s.mootais_sold ?? 0) * (s.price_per_mootai ?? 0)) || 0;
      b[prop] += amt;
    }
  };
  each(buyerSales, 'sale_date', 'buyers');
  each(retailSales, 'sale_date', 'retail');
  const list = Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  return list.map((x) => {
    const [, label] = x.key.split('||');
    return { label, buyers: Math.round(x.buyers), retail: Math.round(x.retail), total: Math.round(x.buyers + x.retail) };
  });
}
