CREATE TABLE `kiosk_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`is_open` integer DEFAULT 1 NOT NULL,
	`allow_second_hour` integer DEFAULT 1 NOT NULL,
	`message` text DEFAULT '' NOT NULL
);
