CREATE TABLE `job_sources` (
	`source` text NOT NULL,
	`source_job_id` text NOT NULL,
	`job_id` text NOT NULL,
	`company_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text NOT NULL,
	`last_run_id` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	PRIMARY KEY(`source`, `source_job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_sources_company_idx` ON `job_sources` (`company_id`);--> statement-breakpoint
CREATE INDEX `job_sources_job_idx` ON `job_sources` (`job_id`);