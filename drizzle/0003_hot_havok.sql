CREATE TABLE `dropbox_config` (
	`id` text PRIMARY KEY NOT NULL,
	`app_key` text NOT NULL,
	`refresh_token_ciphertext` text,
	`refresh_token_iv` text,
	`account_id` text,
	`connected_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dropbox_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `job_files` ADD `dropbox_path` text;--> statement-breakpoint
ALTER TABLE `job_files` ADD `dropbox_status` text DEFAULT 'not_synced' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_files` ADD `dropbox_synced_at` text;--> statement-breakpoint
ALTER TABLE `job_files` ADD `dropbox_error` text;