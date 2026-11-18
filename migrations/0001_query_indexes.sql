CREATE INDEX IF NOT EXISTS `daily_sheets_status_date_idx` ON `daily_sheets` (`status`, `sheet_date`);
CREATE INDEX IF NOT EXISTS `client_orders_sheet_customer_idx` ON `client_orders` (`daily_sheet_id`, `customer_id`);
