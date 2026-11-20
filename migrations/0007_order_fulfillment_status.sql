ALTER TABLE client_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE client_orders ADD COLUMN dispatched_at TEXT;
ALTER TABLE client_orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE client_orders ADD COLUMN cancel_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_client_orders_fulfillment_sheet ON client_orders(fulfillment_status, daily_sheet_id);
