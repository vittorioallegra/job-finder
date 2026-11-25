-- The tracker keeps one "to send" group, applied, accepted and rejected: the ended and in-between
-- statuses fold into them.
UPDATE `applications` SET `status` = 'applied' WHERE `status` = 'interviewing';--> statement-breakpoint
UPDATE `applications` SET `status` = 'accepted' WHERE `status` = 'offer';--> statement-breakpoint
UPDATE `applications` SET `status` = 'rejected' WHERE `status` = 'withdrawn';--> statement-breakpoint
UPDATE `application_events` SET `status` = 'applied' WHERE `status` = 'interviewing';--> statement-breakpoint
UPDATE `application_events` SET `status` = 'accepted' WHERE `status` = 'offer';--> statement-breakpoint
UPDATE `application_events` SET `status` = 'rejected' WHERE `status` = 'withdrawn';
