export type UserRole = 'admin' | 'operator' | 'viewer';

export type ProductCategory = 'blanket' | 'heater' | 'other';
export type ProductGrade = 'first_grade' | 'second_grade';
export type ItemType = 'carton' | 'bag' | 'piece' | 'kg';

export type DailySheetStatus = 'open' | 'closed' | 'archived';
export type DeliveryType = 'client_warehouse' | 'sub_merchant';
export type OrderMode = ItemType;

export interface UserPermissions {
  dailySheets: {
    view: boolean;
    create: boolean;
    edit: boolean;
    archive: boolean;
  };
  orders: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
  catalog: {
    view: boolean;
    manage: boolean;
  };
  customers: {
    view: boolean;
    manage: boolean;
  };
  reports: {
    view: boolean;
    exportExcel: boolean;
    exportPdf: boolean;
  };
  users: {
    manage: boolean;
  };
  settings: {
    manage: boolean;
  };
}

export interface SystemSettingsDTO {
  id: number;
  companyName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  startingOrderNumber: number;
  updatedAt: string;
}

export interface UserDTO {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  permissions: UserPermissions;
  isActive: boolean;
  createdAt: string;
}

export interface LoginRequestDTO {
  username: string;
  password: string;
}

export interface LoginResponseDTO {
  user: UserDTO;
  nextSheetNumber: string;
}

export interface UpdateSystemSettingsDTO {
  companyName: string;
  startingOrderNumber: number;
  logoUrl?: string | null;
  faviconUrl?: string | null;
}

export interface CreateUserDTO {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  permissions?: UserPermissions;
  isActive?: boolean;
}

export interface UpdateUserDTO {
  username?: string;
  password?: string;
  fullName?: string;
  role?: UserRole;
  permissions?: UserPermissions;
  isActive?: boolean;
}

export interface UploadAssetResponseDTO {
  url: string;
  key: string;
  type: 'logo' | 'favicon';
  settings: SystemSettingsDTO;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}

export interface ProductDTO {
  id: number;
  code: string;
  name: string;
  category: ProductCategory;
  grade: ProductGrade;
  itemType: ItemType;
  packingCapacity: number;
  weight: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateProductDTO {
  code: string;
  name: string;
  category: ProductCategory;
  grade: ProductGrade;
  itemType: ItemType;
  packingCapacity: number;
  weight?: string | number | null;
  isActive?: boolean;
}

export interface UpdateProductDTO {
  code?: string;
  name?: string;
  category?: ProductCategory;
  grade?: ProductGrade;
  itemType?: ItemType;
  packingCapacity?: number;
  weight?: string | number | null;
  isActive?: boolean;
}

export interface SubMerchantDTO {
  id: number;
  customerId: number;
  name: string;
  phone: string | null;
  location: string | null;
  createdAt: string;
}

export interface CustomerDTO {
  id: number;
  clientCode: string;
  name: string;
  defaultPhone: string | null;
  defaultLocation: string | null;
  representativeName?: string | null;
  createdAt: string;
  subMerchantsCount: number;
  subMerchants?: SubMerchantDTO[];
}

export interface CreateCustomerDTO {
  clientCode: string;
  name: string;
  defaultPhone?: string | null;
  defaultLocation?: string | null;
  representativeName?: string | null;
}

export interface UpdateCustomerDTO {
  clientCode?: string;
  name?: string;
  defaultPhone?: string | null;
  defaultLocation?: string | null;
  representativeName?: string | null;
}

export interface CreateSubMerchantDTO {
  customerId: number;
  name: string;
  phone?: string | null;
  location?: string | null;
}

export interface UpdateSubMerchantDTO {
  name?: string;
  phone?: string | null;
  location?: string | null;
}

export interface DashboardStatsDTO {
  activeProducts: number;
  customers: number;
  subMerchants: number;
  openDailySheets: number;
  openCartons: number;
  openPieces: number;
  todayOrderCount: number;
  openWeightKg: number;
  recentSheets: Array<{
    id: number;
    sheetNumber: string;
    sheetDate: string;
    status: DailySheetStatus;
    totalCartons: number;
    totalPieces: number;
    totalWeightKg: number;
    updatedAt: string;
  }>;
}

export interface DailySheetListItemDTO {
  id: number;
  sheetNumber: string;
  sheetDate: string;
  status: DailySheetStatus;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
  notes: string | null;
  createdBy: number | null;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemDetailDTO {
  id: number;
  productId: number;
  productCode: string;
  productName: string;
  orderMode: OrderMode;
  cartonsQty: number;
  packingCapacitySnapshot: number;
  totalPieces: number;
  weightKg: number;
  notes: string | null;
}

export interface ClientOrderDetailDTO {
  id: number;
  dailySheetId: number;
  customerId: number;
  customerCode: string;
  customerName: string;
  deliveryType: DeliveryType;
  subMerchantId: number | null;
  subMerchantName: string | null;
  subMerchantPhone: string | null;
  recipientName: string | null;
  deliveryPhone: string;
  deliveryLocation: string;
  trucksCount: number;
  representativeName: string | null;
  warehouseRef: string | null;
  notes: string | null;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
  items: OrderItemDetailDTO[];
}

export interface DailySheetDetailDTO extends DailySheetListItemDTO {
  orders: ClientOrderDetailDTO[];
}

export interface CreateDailySheetDTO {
  sheetNumber?: string;
  sheetDate?: string;
  notes?: string | null;
}

export interface UpdateDailySheetDTO {
  sheetNumber?: string;
  sheetDate?: string;
  status?: DailySheetStatus;
  notes?: string | null;
}

export interface OrderItemInputDTO {
  productId: number;
  orderMode: OrderMode;
  cartonsQty: number;
  loosePiecesQty: number;
  weightKg: number;
  notes?: string | null;
}

export interface CreateClientOrderDTO {
  dailySheetId: number;
  customerId: number;
  deliveryType: DeliveryType;
  subMerchantId?: number | null;
  recipientName?: string | null;
  deliveryPhone: string;
  deliveryLocation: string;
  trucksCount?: number;
  representativeName?: string | null;
  warehouseRef?: string | null;
  notes?: string | null;
  items: OrderItemInputDTO[];
}

export type ReportPeriod = 'daily' | 'monthly' | 'yearly' | 'custom';

export interface ReportSummaryDTO {
  totalSheets: number;
  totalOrders: number;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
  uniqueCustomers: number;
}

export interface ReportProductTotalDTO {
  productId: number;
  productCode: string;
  productName: string;
  unitType: ItemType;
  ordersCount: number;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
}

export interface ReportChannelDTO {
  deliveryType: DeliveryType;
  subMerchantId: number | null;
  subMerchantName: string | null;
  ordersCount: number;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
  products: ReportProductTotalDTO[];
}

export interface ReportCustomerDTO {
  customerId: number;
  clientCode: string;
  customerName: string;
  ordersCount: number;
  totalCartons: number;
  totalPieces: number;
  totalWeightKg: number;
  channels: ReportChannelDTO[];
}

export interface SalesReportDTO {
  period: ReportPeriod;
  label: string;
  from: string;
  to: string;
  summary: ReportSummaryDTO;
  customers: ReportCustomerDTO[];
  products: ReportProductTotalDTO[];
}

export interface UpdateClientOrderDTO {
  customerId: number;
  deliveryType: DeliveryType;
  subMerchantId?: number | null;
  recipientName?: string | null;
  deliveryPhone: string;
  deliveryLocation: string;
  trucksCount?: number;
  representativeName?: string | null;
  warehouseRef?: string | null;
  notes?: string | null;
  items: OrderItemInputDTO[];
}
