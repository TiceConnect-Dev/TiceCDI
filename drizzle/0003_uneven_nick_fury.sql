CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text,
	`roster_kind` text NOT NULL,
	`roster_id` text NOT NULL,
	`roster_name` text NOT NULL,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration` integer NOT NULL,
	`actor` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `planning`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_plan_id_unique` ON `attendance` (`plan_id`);--> statement-breakpoint
CREATE INDEX `attendance_started` ON `attendance` (`started_at`);--> statement-breakpoint
CREATE TABLE `attendance_members` (
	`attendance_id` text NOT NULL,
	`student_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`class_name` text NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`attendance_id`, `student_id`),
	FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`area` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`before_json` text,
	`after_json` text
);
--> statement-breakpoint
CREATE INDEX `audit_at` ON `audit_log` (`at`,`id`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`student_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `student_id`),
	FOREIGN KEY (`group_id`) REFERENCES `school_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `school_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_groups_normalized_unique` ON `school_groups` (`normalized`);--> statement-breakpoint
CREATE TABLE `school_year` (
	`label` text PRIMARY KEY NOT NULL,
	`transition_id` text,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `school_year_members` (
	`year_label` text NOT NULL,
	`student_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`class_name` text NOT NULL,
	PRIMARY KEY(`year_label`, `student_id`),
	FOREIGN KEY (`year_label`) REFERENCES `school_year`(`label`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `kiosk_settings` ADD `capacity` integer;--> statement-breakpoint
ALTER TABLE `kiosk_settings` ADD `hide_weekend` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `planning` ADD `group_id` text REFERENCES school_groups(id);--> statement-breakpoint
ALTER TABLE `visits` ADD `attendance_id` text REFERENCES attendance(id);--> statement-breakpoint
CREATE INDEX `visits_attendance` ON `visits` (`attendance_id`);