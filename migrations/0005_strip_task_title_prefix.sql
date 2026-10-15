-- GitHub 에서 가져온 Task 제목의 「owner/repo#번호 」 접두어를 뗀다. repo#번호 는 Board 가 github_url 에서 보여 준다.
-- 접두어는 github_url(https://github.com/owner/repo/issues|pull/N) 에서 만들고, 제목이 그것으로 시작할 때만 바꾼다.
UPDATE `tasks`
SET `title` = substr(
    `title`,
    length(replace(replace(substr(`github_url`, length('https://github.com/') + 1), '/issues/', '#'), '/pull/', '#') || ' ') + 1
  )
WHERE `github_url` LIKE 'https://github.com/%'
  AND substr(`title`, 1, length(replace(replace(substr(`github_url`, length('https://github.com/') + 1), '/issues/', '#'), '/pull/', '#') || ' '))
    = replace(replace(substr(`github_url`, length('https://github.com/') + 1), '/issues/', '#'), '/pull/', '#') || ' '
  AND length(`title`) > length(replace(replace(substr(`github_url`, length('https://github.com/') + 1), '/issues/', '#'), '/pull/', '#') || ' ');
