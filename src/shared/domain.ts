import type { OrderMode } from './types';

export function requiresPacking(itemType: OrderMode): boolean {
  return itemType === 'carton' || itemType === 'bag';
}

/**
 * Computes strictly-typed piece totals for an order item:
 * - carton/bag: totalPieces = cartonsQty * packingCapacitySnapshot, weightKg = 0
 * - piece: totalPieces is entered directly, cartonsQty = 0, weightKg = 0
 * - kg: totalPieces and weightKg are both entered, cartonsQty = 0
 * Product catalog weight stays informational and is not used here.
 */
export function calculateOrderItemTotals(params: {
  orderMode: OrderMode;
  cartonsQty: number;
  packingCapacitySnapshot: number;
  directPiecesQty?: number;
  weightKg?: number;
}): { cartonsQty: number; totalPieces: number; weightKg: number } {
  const capacity = Math.max(0, Math.trunc(params.packingCapacitySnapshot));

  if (params.orderMode === 'carton' || params.orderMode === 'bag') {
    const cartons = Math.max(0, Math.trunc(params.cartonsQty));
    return {
      cartonsQty: cartons,
      totalPieces: cartons * capacity,
      weightKg: 0,
    };
  }

  const pieces = Math.max(0, Math.trunc(params.directPiecesQty ?? 0));
  const weight = params.orderMode === 'kg' ? Math.max(0, Number(params.weightKg) || 0) : 0;
  return {
    cartonsQty: 0,
    totalPieces: pieces,
    weightKg: Math.round(weight * 1000) / 1000,
  };
}

/**
 * Next sheet number is the highest numeric sheet plus one.
 * The settings start number is used only when no numeric sheet exists yet.
 */
export function computeNextSheetNumber(
  startingOrderNumber: number,
  lastNumericSheetNumber: number | null
): string {
  const baseline = Math.max(1, Math.trunc(startingOrderNumber));
  if (lastNumericSheetNumber === null || Number.isNaN(lastNumericSheetNumber)) {
    return String(baseline);
  }
  return String(Math.trunc(lastNumericSheetNumber) + 1);
}
