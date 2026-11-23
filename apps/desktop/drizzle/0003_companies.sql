CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`careers_url` text NOT NULL,
	`ats` text,
	`slug` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_careers_url_unique` ON `companies` (`careers_url`);