CREATE TABLE `job_scores` (
	`job_id` text NOT NULL,
	`profile_version` integer NOT NULL,
	`job_hash` text NOT NULL,
	`profile_hash` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` integer NOT NULL,
	`score` integer NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `profile_version`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_scores_score_range" CHECK("job_scores"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX `job_scores_profile_version_idx` ON `job_scores` (`profile_version`);