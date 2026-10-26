import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppData } from '../hooks/useAppData.jsx';
import { formatProductQuantities, todayIST } from '../lib/business.js';

export default function LowStockAlerts() {
  const {
    products, inventorySettings, inventorySummary, inventoryCounts, inventoryError,
    inventoryLoading, offline,
  } = useAppData();
  if (offline || inventoryError || inventoryLoading) return null;

  const productsById = new Map(products.map((product) => [product.id, product]));
  const summaryById = new Map(inventorySummary.map((row) => [row.product_id, row]));
  const countedProductIds = new Set(
    inventoryCounts
      .filter((count) => count.stock_date === todayIST())
      .map((count) => count.product_id)
  );
  const lowStockProducts = inventorySettings.flatMap((setting) => {
    const product = productsById.get(setting.product_id);
    if (!product || product.active === false) return [];
    if (!countedProductIds.has(product.id)) return [];
    const stock = summaryById.get(product.id);
    if (!stock) return [];
    const threshold = Number(setting.low_stock_threshold ?? 5);
    const available = Number(stock.quantity_on_hand || 0);
    return threshold > 0 && available <= threshold ? [{ product, available, threshold }] : [];
  });

  if (!lowStockProducts.length) return null;

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-live="polite">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-amber-950">Low stock warning</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {lowStockProducts.map(({ product, available, threshold }) => (
              <li key={product.id}>
                <span className="font-semibold">{product.name}</span>: {formatProductQuantities(product, available)} left
                <span className="text-amber-800"> (warning at {formatProductQuantities(product, threshold)} or less)</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
