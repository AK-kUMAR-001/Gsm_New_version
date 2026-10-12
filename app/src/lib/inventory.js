export function saleStockGuidance(message, productName) {
  const normalized = String(message || '').toLocaleLowerCase();
  if (normalized.includes('stock tracking has not started')) {
    return {
      action: 'opening',
      message: `Enter opening stock for ${productName} before recording this sale.`,
      button: 'Enter opening stock',
    };
  }
  if (normalized.includes("record today's physical stock count")) {
    return {
      action: 'count',
      message: `Record today's physical stock count for ${productName} before recording this sale.`,
      button: 'Record morning count',
    };
  }
  if (normalized.includes('insufficient stock')) {
    return {
      action: 'receipt',
      message: `There is not enough ${productName} stock for this sale. Add extra stock, then return and record the sale.`,
      button: 'Add extra stock',
    };
  }
  return null;
}
