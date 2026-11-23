CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`url` text NOT NULL,
	`apply_url` text NOT NULL,
	`language` text,
	`locations` text NOT NULL,
	`work_mode` text NOT NULL,
	`remote_scope` text,
	`employment_type` text NOT NULL,
	`seniority` text NOT NULL,
	`salary` text,
	`visa_sponsorship` text NOT NULL,
	`posted_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_fingerprint_idx` ON `jobs` (`fingerprint`);