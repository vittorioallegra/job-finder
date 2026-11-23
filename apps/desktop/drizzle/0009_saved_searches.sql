CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`filters` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
