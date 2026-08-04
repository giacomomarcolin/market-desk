CREATE TABLE `ai_config` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`api_key_iv` text NOT NULL,
	`configured_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `salary` text;