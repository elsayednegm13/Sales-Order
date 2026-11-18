import type { ItemType, OrderMode, ProductCategory, ProductGrade } from './types';

export const CATEGORY_LABELS_AR: Record<ProductCategory, string> = {
  blanket: 'بطاطين',
  heater: 'دفايات',
  other: 'أخرى',
};

export const GRADE_LABELS_AR: Record<ProductGrade, string> = {
  first_grade: 'درجة أولى',
  second_grade: 'درجة ثانية',
};

export const PRODUCT_CATEGORIES: ProductCategory[] = ['blanket', 'heater', 'other'];
export const PRODUCT_GRADES: ProductGrade[] = ['first_grade', 'second_grade'];
export const ITEM_TYPES: ItemType[] = ['carton', 'bag', 'piece', 'kg'];

export const ITEM_TYPE_LABELS_AR: Record<ItemType, string> = {
  carton: 'كرتونة',
  bag: 'كيس',
  piece: 'قطعة',
  kg: 'كجم',
};

export const ORDER_MODE_LABELS_AR: Record<OrderMode, string> = ITEM_TYPE_LABELS_AR;

export function orderModesForProduct(itemType: ItemType): OrderMode[] {
  if (itemType === 'piece' || itemType === 'kg') return [itemType];
  return [itemType, 'piece'];
}

export function formatPackingLabel(packingCapacity: number, itemType: ItemType = 'carton'): string {
  if (itemType === 'piece') return 'قطعة';
  if (itemType === 'kg') return 'كجم';
  const unit = itemType === 'bag' ? 'كيس' : 'كرتونة';
  return `التعبئة: ${packingCapacity} قطعة/${unit}`;
}

export function formatWeightLabel(weight: string | null | undefined): string {
  const value = weight?.trim();
  if (!value) {
    return 'بدون وزن مرجعي';
  }
  return /كجم|كغ|kg/i.test(value) ? `الوزن: ${value}` : `الوزن: ${value} كجم`;
}
