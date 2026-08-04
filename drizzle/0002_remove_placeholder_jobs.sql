DELETE FROM `job_files` WHERE `job_id` IN ('job_mit', 'job_stanford', 'job_fed', 'job_cornerstone');
--> statement-breakpoint
DELETE FROM `job_requirements` WHERE `job_id` IN ('job_mit', 'job_stanford', 'job_fed', 'job_cornerstone');
--> statement-breakpoint
DELETE FROM `tasks` WHERE `job_id` IN ('job_mit', 'job_stanford', 'job_fed', 'job_cornerstone');
--> statement-breakpoint
DELETE FROM `jobs` WHERE `id` IN ('job_mit', 'job_stanford', 'job_fed', 'job_cornerstone');
