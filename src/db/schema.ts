import { sql, relations } from 'drizzle-orm';
import {
  sqliteTable,
  integer,
  real,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ============================================================================
// 1. SYSTEM SETTINGS (الهوية وإعدادات النظام)
// ============================================================================
export const cacheVersions = sqliteTable('cache_versions', {
  name: text('name').primaryKey(),
  version: integer('version').notNull().default(1),
});

export const loginRateLimits = sqliteTable(
  'login_rate_limits',
  {
    key: text('key').primaryKey(),
    attempts: integer('attempts').notNull().default(0),
    firstAttemptAt: integer('first_attempt_at').notNull(),
    lockedUntil: integer('locked_until'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('login_rate_limits_updated_at_idx').on(table.updatedAt)],
);

export const systemSettings = sqliteTable('system_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  companyName: text('company_name').notNull().default('نظام إدارة المبيعات'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  startingOrderNumber: integer('starting_order_number').notNull().default(1000),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// ============================================================================
// 2. USERS (المستخدمون والصلاحيات)
// ============================================================================
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role', { enum: ['admin', 'operator', 'viewer'] })
      .notNull()
      .default('operator'),
    permissions: text('permissions').notNull().default('{}'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    tokenVersion: integer('token_version').notNull().default(1),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex('users_username_unique').on(table.username),
    index('users_role_idx').on(table.role),
    index('users_is_active_idx').on(table.isActive),
  ]
);

// ============================================================================
// 3. PRODUCTS (كتالوج البطاطين والدفايات والأصناف)
// `item_type` is how the warehouse loads the product. `weight` stays informational.
// ============================================================================
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category', { enum: ['blanket', 'heater', 'other'] }).notNull(),
    grade: text('grade', { enum: ['first_grade', 'second_grade'] })
      .notNull()
      .default('first_grade'),
    itemType: text('item_type', { enum: ['carton', 'bag', 'piece', 'kg'] })
      .notNull()
      .default('carton'),
    packingCapacity: integer('packing_capacity').notNull(),
    weight: text('weight'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex('products_code_unique').on(table.code),
    index('products_category_idx').on(table.category),
    index('products_grade_idx').on(table.grade),
    index('products_is_active_idx').on(table.isActive),
  ]
);

// ============================================================================
// 4. CUSTOMERS (العملاء الرئيسيون)
// ============================================================================
export const customers = sqliteTable(
  'customers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientCode: text('client_code').notNull(),
    name: text('name').notNull(),
    defaultPhone: text('default_phone'),
    defaultLocation: text('default_location'),
    representativeName: text('representative_name'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex('customers_client_code_unique').on(table.clientCode),
    index('customers_name_idx').on(table.name),
  ]
);

// ============================================================================
// 5. SUB MERCHANTS (التجار الفرعيون التابعون للعملاء)
// ============================================================================
export const subMerchants = sqliteTable(
  'sub_merchants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    location: text('location'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index('sub_merchants_customer_id_idx').on(table.customerId),
    index('sub_merchants_name_idx').on(table.name),
  ]
);

// ============================================================================
// 6. DAILY SHEETS (أوردر اليوم / مرحلة الأوردر اليومي)
// ============================================================================
export const dailySheets = sqliteTable(
  'daily_sheets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sheetNumber: text('sheet_number').notNull(),
    sheetDate: text('sheet_date').notNull(),
    status: text('status', { enum: ['open', 'closed', 'archived'] })
      .notNull()
      .default('open'),
    totalCartons: integer('total_cartons').notNull().default(0),
    totalPieces: integer('total_pieces').notNull().default(0),
    totalWeightKg: real('total_weight_kg').notNull().default(0),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex('daily_sheets_sheet_number_unique').on(table.sheetNumber),
    index('daily_sheets_sheet_date_idx').on(table.sheetDate),
    index('daily_sheets_status_idx').on(table.status),
    index('daily_sheets_status_date_idx').on(table.status, table.sheetDate),
    index('daily_sheets_created_by_idx').on(table.createdBy),
  ]
);

// ============================================================================
// 7. CLIENT ORDERS (طلبات العملاء داخل أوردر اليوم)
// ============================================================================
export const clientOrders = sqliteTable(
  'client_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dailySheetId: integer('daily_sheet_id')
      .notNull()
      .references(() => dailySheets.id, { onDelete: 'cascade' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    deliveryType: text('delivery_type', {
      enum: ['client_warehouse', 'sub_merchant'],
    }).notNull(),
    subMerchantId: integer('sub_merchant_id').references(() => subMerchants.id, {
      onDelete: 'set null',
    }),
    recipientName: text('recipient_name'),
    deliveryPhone: text('delivery_phone').notNull(),
    deliveryLocation: text('delivery_location').notNull(),
    trucksCount: integer('trucks_count').notNull().default(1),
    representativeName: text('representative_name'),
    warehouseRef: text('warehouse_ref'),
    notes: text('notes'),
    totalCartons: integer('total_cartons').notNull().default(0),
    totalPieces: integer('total_pieces').notNull().default(0),
    totalWeightKg: real('total_weight_kg').notNull().default(0),
    fulfillmentStatus: text('fulfillment_status', { enum: ['pending', 'dispatched', 'cancelled'] })
      .notNull()
      .default('pending'),
    dispatchedAt: text('dispatched_at'),
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index('client_orders_daily_sheet_id_idx').on(table.dailySheetId),
    index('client_orders_sheet_customer_idx').on(table.dailySheetId, table.customerId),
    index('client_orders_customer_id_idx').on(table.customerId),
    index('client_orders_sub_merchant_id_idx').on(table.subMerchantId),
    index('idx_client_orders_fulfillment_sheet').on(table.fulfillmentStatus, table.dailySheetId),
  ]
);

// ============================================================================
// 8. ORDER ITEMS (الأصناف المطلوبة - قابلة للتعديل والاستبدال اللحظي)
// ============================================================================
export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientOrderId: integer('client_order_id')
      .notNull()
      .references(() => clientOrders.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    orderMode: text('order_mode', { enum: ['carton', 'bag', 'piece', 'kg'] })
      .notNull()
      .default('carton'),
    cartonsQty: integer('cartons_qty').notNull().default(0),
    packingCapacitySnapshot: integer('packing_capacity_snapshot').notNull(),
    totalPieces: integer('total_pieces').notNull(),
    weightKg: real('weight_kg').notNull().default(0),
    notes: text('notes'),
  },
  (table) => [
    index('order_items_client_order_id_idx').on(table.clientOrderId),
    index('order_items_product_id_idx').on(table.productId),
  ]
);

// ============================================================================
// DRIZZLE RELATIONS
// ============================================================================
export const usersRelations = relations(users, ({ many }) => ({
  dailySheets: many(dailySheets),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  subMerchants: many(subMerchants),
  clientOrders: many(clientOrders),
}));

export const subMerchantsRelations = relations(subMerchants, ({ one, many }) => ({
  customer: one(customers, {
    fields: [subMerchants.customerId],
    references: [customers.id],
  }),
  clientOrders: many(clientOrders),
}));

export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
}));

export const dailySheetsRelations = relations(dailySheets, ({ one, many }) => ({
  creator: one(users, {
    fields: [dailySheets.createdBy],
    references: [users.id],
  }),
  clientOrders: many(clientOrders),
}));

export const clientOrdersRelations = relations(clientOrders, ({ one, many }) => ({
  dailySheet: one(dailySheets, {
    fields: [clientOrders.dailySheetId],
    references: [dailySheets.id],
  }),
  customer: one(customers, {
    fields: [clientOrders.customerId],
    references: [customers.id],
  }),
  subMerchant: one(subMerchants, {
    fields: [clientOrders.subMerchantId],
    references: [subMerchants.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  clientOrder: one(clientOrders, {
    fields: [orderItems.clientOrderId],
    references: [clientOrders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// INFERRED ENTITY TYPES
// ============================================================================
export type LoginRateLimitRow = typeof loginRateLimits.$inferSelect;

export type SystemSettingRow = typeof systemSettings.$inferSelect;
export type NewSystemSettingRow = typeof systemSettings.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;

export type SubMerchantRow = typeof subMerchants.$inferSelect;
export type NewSubMerchantRow = typeof subMerchants.$inferInsert;

export type DailySheetRow = typeof dailySheets.$inferSelect;
export type NewDailySheetRow = typeof dailySheets.$inferInsert;

export type ClientOrderRow = typeof clientOrders.$inferSelect;
export type NewClientOrderRow = typeof clientOrders.$inferInsert;

export type OrderItemRow = typeof orderItems.$inferSelect;
export type NewOrderItemRow = typeof orderItems.$inferInsert;

export const passwordResetRequests = sqliteTable(
  'password_reset_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash'),
    status: text('status', { enum: ['pending', 'issued', 'used', 'revoked'] }).notNull().default('pending'),
    requestedAt: integer('requested_at').notNull(),
    expiresAt: integer('expires_at'),
    usedAt: integer('used_at'),
    issuedBy: integer('issued_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('password_reset_requests_user_status_idx').on(table.userId, table.status),
    index('password_reset_requests_status_requested_idx').on(table.status, table.requestedAt),
  ],
);

export const adminRecoveryCodes = sqliteTable(
  'admin_recovery_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    batchId: text('batch_id').notNull(),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('admin_recovery_codes_user_used_idx').on(table.userId, table.usedAt)],
);

export type PasswordResetRequestRow = typeof passwordResetRequests.$inferSelect;
export type AdminRecoveryCodeRow = typeof adminRecoveryCodes.$inferSelect;

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: integer('created_at').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUsername: text('actor_username').notNull(),
    actorFullName: text('actor_full_name').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    entityLabel: text('entity_label'),
    summary: text('summary').notNull(),
    detailsJson: text('details_json'),
    ipAddress: text('ip_address'),
  },
  (table) => [
    index('idx_audit_logs_created_at').on(table.createdAt),
    index('idx_audit_logs_module_created').on(table.module, table.createdAt),
    index('idx_audit_logs_actor_created').on(table.actorUserId, table.createdAt),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
