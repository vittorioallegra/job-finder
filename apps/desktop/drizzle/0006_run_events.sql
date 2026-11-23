CREATE TABLE `run_events` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	PRIMARY KEY(`run_id`, `seq`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
