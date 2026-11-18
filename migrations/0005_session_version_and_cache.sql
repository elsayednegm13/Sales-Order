ALTER TABLE `users` ADD COLUMN `token_version` integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS `cache_versions` (
  `name` text PRIMARY KEY NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);

INSERT INTO `cache_versions` (`name`, `version`) VALUES
  ('products', 1),
  ('customers', 1),
  ('settings', 1),
  ('dashboard', 1),
  ('next_sheet', 1)
ON CONFLICT(`name`) DO NOTHING;
