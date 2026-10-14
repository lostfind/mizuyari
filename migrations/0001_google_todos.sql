CREATE TABLE `google_todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` text NOT NULL,
	`list_title` text NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due` text,
	`web_view_link` text,
	`position` text DEFAULT '' NOT NULL,
	`updated` text NOT NULL,
	`synced_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_todos_list_task_uq` ON `google_todos` (`list_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `google_todos_due_idx` ON `google_todos` (`due`);