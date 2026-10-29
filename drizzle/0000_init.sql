CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_token_hash` text NOT NULL,
	`csrf_token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_session_token_hash_unique` ON `admin_sessions` (`session_token_hash`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`invite_token` text NOT NULL,
	`visibility` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_image_url` text,
	`location` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`price_cents` integer NOT NULL,
	`capacity` integer NOT NULL,
	`booking_deadline` text,
	`extra_info` text DEFAULT '' NOT NULL,
	`max_per_booking` integer DEFAULT 10 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "events_price_check" CHECK("events"."price_cents" >= 0),
	CONSTRAINT "events_capacity_check" CHECK("events"."capacity" >= 1),
	CONSTRAINT "events_dates_check" CHECK("events"."ends_at" IS NULL OR "events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_deadline_check" CHECK("events"."booking_deadline" IS NULL OR "events"."booking_deadline" <= "events"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_invite_token_unique` ON `events` (`invite_token`);--> statement-breakpoint
CREATE INDEX `events_status_visibility_starts_idx` ON `events` (`status`,`visibility`,`starts_at`);--> statement-breakpoint
CREATE TABLE `payment_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`wero_instructions` text DEFAULT '' NOT NULL,
	`wero_qr_image_url` text,
	`paypal_me_url` text,
	`pending_ttl_hours` integer DEFAULT 24 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`reference` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`quantity` integer NOT NULL,
	`total_amount_cents` integer NOT NULL,
	`payment_method` text,
	`payment_status` text NOT NULL,
	`payment_declared_at` text,
	`access_token_hash` text NOT NULL,
	`idempotency_key` text,
	`expires_at` text,
	`confirmed_at` text,
	`cancelled_at` text,
	`expired_at` text,
	`anonymized_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservations_quantity_check" CHECK("reservations"."quantity" >= 1),
	CONSTRAINT "reservations_amount_check" CHECK("reservations"."total_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_reference_unique` ON `reservations` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_access_token_hash_unique` ON `reservations` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_event_idempotency_unique` ON `reservations` (`event_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `reservations_event_idx` ON `reservations` (`event_id`);--> statement-breakpoint
CREATE INDEX `reservations_event_status_idx` ON `reservations` (`event_id`,`payment_status`);--> statement-breakpoint
CREATE INDEX `reservations_email_idx` ON `reservations` (`email`);--> statement-breakpoint
CREATE INDEX `reservations_status_expires_idx` ON `reservations` (`payment_status`,`expires_at`);