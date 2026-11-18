PRAGMA foreign_keys = OFF;

CREATE TABLE `daily_sheets_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `sheet_number` text NOT NULL,
  `sheet_date` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'closed', 'archived')),
  `total_cartons` integer DEFAULT 0 NOT NULL,
  `total_pieces` integer DEFAULT 0 NOT NULL,
  `notes` text,
  `created_by` integer,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `total_weight_kg` real DEFAULT 0 NOT NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

INSERT INTO `daily_sheets_new` (
  `id`, `sheet_number`, `sheet_date`, `status`, `total_cartons`, `total_pieces`,
  `notes`, `created_by`, `created_at`, `updated_at`, `total_weight_kg`
)
SELECT
  `id`, `sheet_number`, `sheet_date`, `status`, `total_cartons`, `total_pieces`,
  `notes`, `created_by`, `created_at`, `updated_at`, `total_weight_kg`
FROM `daily_sheets`;

CREATE TABLE `client_orders_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `daily_sheet_id` integer NOT NULL,
  `customer_id` integer NOT NULL,
  `delivery_type` text NOT NULL CHECK (`delivery_type` IN ('client_warehouse', 'sub_merchant')),
  `sub_merchant_id` integer,
  `recipient_name` text,
  `delivery_phone` text NOT NULL,
  `delivery_location` text NOT NULL,
  `trucks_count` integer DEFAULT 1 NOT NULL,
  `representative_name` text,
  `warehouse_ref` text,
  `notes` text,
  `total_cartons` integer DEFAULT 0 NOT NULL,
  `total_pieces` integer DEFAULT 0 NOT NULL,
  `total_weight_kg` real DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`daily_sheet_id`) REFERENCES `daily_sheets_new`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`sub_merchant_id`) REFERENCES `sub_merchants`(`id`) ON UPDATE no action ON DELETE set null
);

INSERT INTO `client_orders_new` (
  `id`, `daily_sheet_id`, `customer_id`, `delivery_type`, `sub_merchant_id`, `recipient_name`,
  `delivery_phone`, `delivery_location`, `trucks_count`, `representative_name`, `warehouse_ref`,
  `notes`, `total_cartons`, `total_pieces`, `total_weight_kg`, `created_at`, `updated_at`
)
SELECT
  `id`, `daily_sheet_id`, `customer_id`, `delivery_type`, `sub_merchant_id`, `recipient_name`,
  `delivery_phone`, `delivery_location`, `trucks_count`, `representative_name`, `warehouse_ref`,
  `notes`, `total_cartons`, `total_pieces`, `total_weight_kg`, `created_at`, `updated_at`
FROM `client_orders`;

CREATE TABLE `order_items_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_order_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `order_mode` text DEFAULT 'carton' NOT NULL CHECK (`order_mode` IN ('carton', 'bag', 'piece', 'kg')),
  `cartons_qty` integer DEFAULT 0 NOT NULL,
  `packing_capacity_snapshot` integer NOT NULL,
  `total_pieces` integer NOT NULL,
  `weight_kg` real DEFAULT 0 NOT NULL,
  `notes` text,
  FOREIGN KEY (`client_order_id`) REFERENCES `client_orders_new`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `order_items_new` (
  `id`, `client_order_id`, `product_id`, `order_mode`, `cartons_qty`,
  `packing_capacity_snapshot`, `total_pieces`, `weight_kg`, `notes`
)
SELECT
  `id`, `client_order_id`, `product_id`, `order_mode`, `cartons_qty`,
  `packing_capacity_snapshot`, `total_pieces`, `weight_kg`, `notes`
FROM `order_items`;

DROP TABLE `order_items`;
DROP TABLE `client_orders`;
DROP TABLE `daily_sheets`;

ALTER TABLE `daily_sheets_new` RENAME TO `daily_sheets`;
ALTER TABLE `client_orders_new` RENAME TO `client_orders`;
ALTER TABLE `order_items_new` RENAME TO `order_items`;

CREATE UNIQUE INDEX IF NOT EXISTS `daily_sheets_sheet_number_unique` ON `daily_sheets` (`sheet_number`);
CREATE INDEX IF NOT EXISTS `daily_sheets_sheet_date_idx` ON `daily_sheets` (`sheet_date`);
CREATE INDEX IF NOT EXISTS `daily_sheets_status_idx` ON `daily_sheets` (`status`);
CREATE INDEX IF NOT EXISTS `daily_sheets_status_date_idx` ON `daily_sheets` (`status`, `sheet_date`);
CREATE INDEX IF NOT EXISTS `daily_sheets_created_by_idx` ON `daily_sheets` (`created_by`);
CREATE INDEX IF NOT EXISTS `client_orders_daily_sheet_id_idx` ON `client_orders` (`daily_sheet_id`);
CREATE INDEX IF NOT EXISTS `client_orders_customer_id_idx` ON `client_orders` (`customer_id`);
CREATE INDEX IF NOT EXISTS `client_orders_sub_merchant_id_idx` ON `client_orders` (`sub_merchant_id`);
CREATE INDEX IF NOT EXISTS `client_orders_sheet_customer_idx` ON `client_orders` (`daily_sheet_id`, `customer_id`);
CREATE INDEX IF NOT EXISTS `order_items_client_order_id_idx` ON `order_items` (`client_order_id`);
CREATE INDEX IF NOT EXISTS `order_items_product_id_idx` ON `order_items` (`product_id`);

DELETE FROM `sqlite_sequence` WHERE `name` IN ('daily_sheets', 'client_orders', 'order_items');
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'daily_sheets', COALESCE(MAX(`id`), 0) FROM `daily_sheets`;
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'client_orders', COALESCE(MAX(`id`), 0) FROM `client_orders`;
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'order_items', COALESCE(MAX(`id`), 0) FROM `order_items`;

PRAGMA foreign_keys = ON;
