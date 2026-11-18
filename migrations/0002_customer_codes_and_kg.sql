PRAGMA foreign_keys = OFF;

ALTER TABLE `customers` ADD COLUMN `client_code` text NOT NULL DEFAULT '';
UPDATE `customers` SET `client_code` = 'C-101' WHERE `name` = 'مؤسسة النور للتجارة' AND `client_code` = '';
UPDATE `customers` SET `client_code` = 'C-102' WHERE `name` = 'شركة الأمل للتوزيع' AND `client_code` = '';
UPDATE `customers` SET `client_code` = 'C-103' WHERE `name` = 'محلات السلام' AND `client_code` = '';
UPDATE `customers` SET `client_code` = 'C-' || `id` WHERE `client_code` = '';
CREATE UNIQUE INDEX IF NOT EXISTS `customers_client_code_unique` ON `customers` (`client_code`);

ALTER TABLE `daily_sheets` ADD COLUMN `total_weight_kg` real NOT NULL DEFAULT 0;

ALTER TABLE `client_orders` ADD COLUMN `trucks_count` integer NOT NULL DEFAULT 1;
ALTER TABLE `client_orders` ADD COLUMN `representative_name` text;
ALTER TABLE `client_orders` ADD COLUMN `warehouse_ref` text;
ALTER TABLE `client_orders` ADD COLUMN `notes` text;
ALTER TABLE `client_orders` ADD COLUMN `total_weight_kg` real NOT NULL DEFAULT 0;

CREATE TABLE `order_items_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_order_id` integer NOT NULL,
  `product_id` integer NOT NULL,
  `order_mode` text DEFAULT 'carton' NOT NULL CHECK (`order_mode` IN ('carton', 'piece', 'kg')),
  `cartons_qty` integer DEFAULT 0 NOT NULL,
  `packing_capacity_snapshot` integer NOT NULL,
  `total_pieces` integer NOT NULL,
  `weight_kg` real DEFAULT 0 NOT NULL,
  `notes` text,
  FOREIGN KEY (`client_order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `order_items_new` (
  `id`, `client_order_id`, `product_id`, `order_mode`, `cartons_qty`,
  `packing_capacity_snapshot`, `total_pieces`, `weight_kg`, `notes`
)
SELECT
  `id`, `client_order_id`, `product_id`, `order_mode`, `cartons_qty`,
  `packing_capacity_snapshot`, `total_pieces`, 0, NULL
FROM `order_items`;

DROP TABLE `order_items`;
ALTER TABLE `order_items_new` RENAME TO `order_items`;
CREATE INDEX IF NOT EXISTS `order_items_client_order_id_idx` ON `order_items` (`client_order_id`);
CREATE INDEX IF NOT EXISTS `order_items_product_id_idx` ON `order_items` (`product_id`);
DELETE FROM `sqlite_sequence` WHERE `name` = 'order_items';
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'order_items', COALESCE(MAX(`id`), 0) FROM `order_items`;

PRAGMA foreign_keys = ON;
