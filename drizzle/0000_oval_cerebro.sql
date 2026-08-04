CREATE TABLE `collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`status` text NOT NULL,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`items_added` integer DEFAULT 0 NOT NULL,
	`message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `source_monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`label` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`document_version` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization` text NOT NULL,
	`department` text,
	`title` text NOT NULL,
	`sector` text NOT NULL,
	`location` text,
	`deadline` text,
	`source` text NOT NULL,
	`source_url` text,
	`source_snapshot` text,
	`collection_mode` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'Saved' NOT NULL,
	`next_action` text,
	`notes` text,
	`starred` integer DEFAULT false NOT NULL,
	`captured_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_url_unique` ON `jobs` (`source_url`);--> statement-breakpoint
CREATE TABLE `source_monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`method` text NOT NULL,
	`url` text,
	`status` text NOT NULL,
	`cadence_hours` integer DEFAULT 24 NOT NULL,
	`last_checked_at` text,
	`next_check_at` text,
	`items_added` integer DEFAULT 0 NOT NULL,
	`message` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`title` text NOT NULL,
	`due_at` text,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
