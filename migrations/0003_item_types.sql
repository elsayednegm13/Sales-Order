ALTER TABLE `products` ADD COLUMN `item_type` text NOT NULL DEFAULT 'carton' CHECK (`item_type` IN ('carton', 'bag', 'piece', 'kg'));

PRAGMA foreign_keys = OFF;

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
  FOREIGN KEY (`client_order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE cascade,
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
ALTER TABLE `order_items_new` RENAME TO `order_items`;
CREATE INDEX IF NOT EXISTS `order_items_client_order_id_idx` ON `order_items` (`client_order_id`);
CREATE INDEX IF NOT EXISTS `order_items_product_id_idx` ON `order_items` (`product_id`);
DELETE FROM `sqlite_sequence` WHERE `name` = 'order_items';
INSERT INTO `sqlite_sequence` (`name`, `seq`) SELECT 'order_items', COALESCE(MAX(`id`), 0) FROM `order_items`;

PRAGMA foreign_keys = ON;
