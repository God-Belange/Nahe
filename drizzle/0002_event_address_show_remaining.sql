ALTER TABLE `events` ADD `address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `show_remaining` integer DEFAULT true NOT NULL;