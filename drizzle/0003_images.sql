CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL
);
