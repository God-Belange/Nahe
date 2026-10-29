CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`event_id` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	`checked_in_at` text,
	`voided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tickets_seq_check" CHECK("tickets"."seq" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_reservation_seq_unique` ON `tickets` (`reservation_id`,`seq`);--> statement-breakpoint
CREATE INDEX `tickets_event_status_idx` ON `tickets` (`event_id`,`status`);--> statement-breakpoint
ALTER TABLE `reservations` ADD `tickets_emailed_at` text;