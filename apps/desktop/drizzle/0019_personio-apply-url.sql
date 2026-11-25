-- A Personio posting page shows its form only after a click; the form has its own page. Postings
-- stored before that point their apply link at the posting page.
UPDATE `jobs` SET `apply_url` = `url` || '/apply' WHERE `apply_url` = `url` AND `url` LIKE 'https://%.jobs.personio.de/job/%' AND `url` NOT LIKE '%/apply';--> statement-breakpoint
UPDATE `job_sources` SET `apply_url` = `url` || '/apply' WHERE `source` = 'personio' AND `apply_url` = `url` AND `url` NOT LIKE '%/apply';
