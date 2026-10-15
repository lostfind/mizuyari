-- 캘린더·Google TODO·Task 완료 활동 제목의 접두어를 뗀다. 종류는 화면과 리포트의 라벨(Calendar / TODO / Task)이 보여 준다.
UPDATE `activities` SET `title` = substr(`title`, length('미팅 · ') + 1)
WHERE `source` = 'calendar_event' AND substr(`title`, 1, length('미팅 · ')) = '미팅 · ' AND length(`title`) > length('미팅 · ');
--> statement-breakpoint
UPDATE `activities` SET `title` = substr(`title`, length('TODO 완료 · ') + 1)
WHERE `source` = 'google_task' AND substr(`title`, 1, length('TODO 완료 · ')) = 'TODO 완료 · ' AND length(`title`) > length('TODO 완료 · ');
--> statement-breakpoint
UPDATE `activities` SET `title` = substr(`title`, length('Task 완료 · ') + 1)
WHERE `source` = 'task_status' AND substr(`title`, 1, length('Task 완료 · ')) = 'Task 완료 · ' AND length(`title`) > length('Task 완료 · ');
