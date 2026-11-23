CREATE TABLE `job_flags` (
	`job_id` text PRIMARY KEY NOT NULL,
	`dismissed_at` integer,
	`viewed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
