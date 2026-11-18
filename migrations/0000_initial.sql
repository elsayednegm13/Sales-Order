-- ============================================================================
-- Initial Schema Migration: Enterprise Order, Catalog & Reporting System
-- Cloudflare D1 (SQLite) + Drizzle ORM
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_name` text DEFAULT 'نظام إدارة المبيعات' NOT NULL,
  `logo_url` text,
  `favicon_url` text,
  `starting_order_number` integer DEFAULT 1000 NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `full_name` text NOT NULL,
  `role` text DEFAULT 'operator' NOT NULL CHECK (`role` IN ('admin', 'operator', 'viewer')),
  `permissions` text DEFAULT '{}' NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);
CREATE INDEX IF NOT EXISTS `users_role_idx` ON `users` (`role`);
CREATE INDEX IF NOT EXISTS `users_is_active_idx` ON `users` (`is_active`);

CREATE TABLE IF NOT EXISTS `products` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL CHECK (`category` IN ('blanket', 'heater', 'other')),
  `grade` text DEFAULT 'first_grade' NOT NULL CHECK (`grade` IN ('first_grade', 'second_grade')),
  `packing_capacity` integer NOT NULL,
  `weight` text,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `products_code_unique` ON `products` (`code`);
CREATE INDEX IF NOT EXISTS `products_category_idx` ON `products` (`category`);
CREATE INDEX IF NOT EXISTS `products_grade_idx` ON `products` (`grade`);
CREATE INDEX IF NOT EXISTS `products_is_active_idx` ON `products` (`is_active`);

CREATE TABLE IF NOT EXISTS `customers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `default_phone` text,
  `default_location` text,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE INDEX IF NOT EXISTS `customers_name_idx` ON `customers` (`name`);

CREATE TABLE IF NOT EXISTS `sub_merchants` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `customer_id` integer NOT NULL,
  `name` text NOT NULL,
  `phone` text,
  `location` text,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `sub_merchants_customer_id_idx` ON `sub_merchants` (`customer_id`);
CREATE INDEX IF NOT EXISTS `sub_merchants_name_idx` ON `sub_merchants` (`name`);

CREATE TABLE IF NOT EXISTS `daily_sheets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `sheet_number` text NOT NULL,
  `sheet_date` text NOT NULL,
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'archived')),
  `total_cartons` integer DEFAULT 0 NOT NULL,
  `total_pieces` integer DEFAULT 0 NOT NULL,
  `notes` text,
  `created_by` integer,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS `daily_sheets_sheet_number_unique` ON `daily_sheets` (`sheet_number`);
CREATE INDEX IF NOT EXISTS `daily_sheets_sheet_date_idx` ON `daily_sheets` (`sheet_date`);
CREATE INDEX IF NOT EXISTS `daily_sheets_status_idx` ON `daily_sheets` (`status`);
CREATE INDEX IF NOT EXISTS `daily_sheets_created_by_idx` ON `daily_sheets` (`created_by`);

CREATE TABLE IF NOT EXISTS `client_orders` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `daily_sheet_id` integer NOT NULL,
  `customer_id` integer NOT NULL,
  `delivery_type` text NOT NULL CHECK (`delivery_type` IN ('client_warehouse', 'sub_merchant')),
  `sub_merchant_id` integer,
  `recipient_name` text,
  `delivery_phone` text NOT NULL,
  `delivery_location` text NOT NULL,
  `total_cartons` integer DEFAULT 0 NOT NULL,
  `total_pieces` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`daily_sheet_id`) REFERENCES `daily_sheets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`sub_merchant_id`) REFERENCES `sub_merchants`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX IF NOT EXISTS `client_orders_daily_sheet_id_idx` ON `client_orders` (`daily_sheet_id`);
CREATE INDEX IF NOT EXISTS `client_orders_customer_id_idx` ON `client_orders` (`customer_id`);
CREATE INDEX IF NOT EXISTS `client_orders_sub_merchant_id_idx` ON `client_orders` (`sub_merchant_id`);

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_order_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `order_mode` text DEFAULT 'carton' NOT NULL CHECK (`order_mode` IN ('carton', 'piece')),
  `cartons_qty` integer DEFAULT 0 NOT NULL,
  `packing_capacity_snapshot` integer NOT NULL,
  `total_pieces` integer NOT NULL,
  FOREIGN KEY (`client_order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE INDEX IF NOT EXISTS `order_items_client_order_id_idx` ON `order_items` (`client_order_id`);
CREATE INDEX IF NOT EXISTS `order_items_product_id_idx` ON `order_items` (`product_id`);

-- Seed Singleton System Settings Row
INSERT INTO `system_settings` (`id`, `company_name`, `logo_url`, `favicon_url`, `starting_order_number`)
SELECT 1, 'نظام إدارة المبيعات', NULL, NULL, 1000
WHERE NOT EXISTS (SELECT 1 FROM `system_settings` WHERE `id` = 1);
