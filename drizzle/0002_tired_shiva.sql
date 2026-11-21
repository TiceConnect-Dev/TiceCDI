CREATE TABLE `opening_hours` (
	`weekday` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	PRIMARY KEY(`weekday`, `start_min`)
);
--> statement-breakpoint
CREATE TABLE `planning` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`class_id` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `planning_day` ON `planning` (`day`,`start_min`);--> statement-breakpoint
ALTER TABLE `kiosk_settings` ADD `use_hours` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `visits` ADD `source` text DEFAULT 'individuel' NOT NULL;--> statement-breakpoint
ALTER TABLE `visits` ADD `class_name` text;--> statement-breakpoint
CREATE INDEX `visits_started` ON `visits` (`starts_at`);