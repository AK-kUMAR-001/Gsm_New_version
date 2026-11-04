import { shiftDateKey } from './business.js';

export const RETAIL_START_WORKFLOW_INTENT = 'gsm.dailyWorkflow.startRetailAfterBuyers';
export const RETAIL_START_WORKFLOW_REQUEST_EVENT = 'gsm:request-retail-start-workflow';

function istDate(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const ist = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

export function firstIncompleteBusinessDay({
  startDate,
  today,
  holidays,
  activeBuyers,
  buyerProgress,
  buyerSales,
  trackedProducts,
  inventoryCounts,
  retailDaySessions,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))
    || startDate > today) return null;

  const holidayDates = new Set((holidays || []).map((holiday) => holiday.sale_date));
  const completedBuyers = new Set((buyerProgress || []).map((row) => `${row.sale_date}:${row.buyer_id}`));
  for (const sale of buyerSales || []) {
    const saleDate = String(sale.sale_date || '').slice(0, 10);
    if (saleDate && sale.buyer_id) completedBuyers.add(`${saleDate}:${sale.buyer_id}`);
  }
  const countedProducts = new Set((inventoryCounts || []).map((row) => `${row.stock_date}:${row.product_id}`));
  const retailSessions = new Set((retailDaySessions || []).map((session) => session.sale_date));

  for (let date = startDate; date <= today; date = shiftDateKey(date, 1)) {
    if (holidayDates.has(date)) continue;

    const missingStockProductIds = (trackedProducts || [])
      .filter((product) => istDate(product.enabled_at) <= date)
      .filter((product) => !countedProducts.has(`${date}:${product.id}`))
      .map((product) => product.id);
    if (missingStockProductIds.length) {
      return { date, step: 'stock', missingStockProductIds };
    }

    const buyer = [...(activeBuyers || [])]
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
      .find((item) => !completedBuyers.has(`${date}:${item.id}`));
    if (buyer) return { date, step: 'buyer', buyer, missingStockProductIds: [] };

    if ((trackedProducts || []).length && !retailSessions.has(date)) {
      return { date, step: 'retail', missingStockProductIds: [] };
    }
  }
  return null;
}
