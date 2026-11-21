CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`permissions` text NOT NULL,
	`admin` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_normalized_unique` ON `classes` (`normalized`);--> statement-breakpoint
CREATE TABLE `exclusions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`reason` text NOT NULL,
	`until_day` text NOT NULL,
	`created_at` integer NOT NULL,
	`author` text NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exclusions_student` ON `exclusions` (`student_id`,`until_day`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`scope` text NOT NULL,
	`slot` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`scope`, `slot`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_account` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`search_name` text NOT NULL,
	`name_key` text NOT NULL,
	`class_id` text NOT NULL,
	`code` text NOT NULL,
	`external_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_code_unique` ON `students` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `students_external_id_unique` ON `students` (`external_id`);--> statement-breakpoint
CREATE INDEX `students_class` ON `students` (`class_id`);--> statement-breakpoint
CREATE INDEX `students_identity` ON `students` (`name_key`,`class_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visits_current` ON `visits` (`expires_at`,`ended_at`);--> statement-breakpoint
CREATE INDEX `visits_student` ON `visits` (`student_id`);