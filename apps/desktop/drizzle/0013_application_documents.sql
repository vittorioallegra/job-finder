CREATE TABLE `application_documents` (
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL,
	`exported_at` integer,
	PRIMARY KEY(`application_id`, `kind`),
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "application_documents_kind" CHECK("application_documents"."kind" in ('cv', 'cover-letter'))
);
