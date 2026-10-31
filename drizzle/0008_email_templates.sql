CREATE TABLE `email_templates` (
	`kind` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`intro` text NOT NULL,
	`footer` text NOT NULL,
	`updated_at` text NOT NULL
);
