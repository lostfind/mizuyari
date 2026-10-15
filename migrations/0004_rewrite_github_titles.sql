-- GitHub 활동 제목을 「상태 · repo#번호 제목」에서 「제목 (repo#번호)」로 바꾼다.
-- 종류·상태(Issue closed, PR merged 등)는 화면과 리포트의 라벨이 metadata 로 보여 준다.
-- 접두어 「… · repo#번호 」가 있는 행만 바꾸므로 다시 돌려도 결과가 같다.
UPDATE `activities`
SET `title` = substr(
    `title`,
    instr(`title`, ' · ' || json_extract(`metadata`, '$.repo') || '#' || json_extract(`metadata`, '$.number') || ' ')
      + length(' · ' || json_extract(`metadata`, '$.repo') || '#' || json_extract(`metadata`, '$.number') || ' ')
  ) || ' (' || json_extract(`metadata`, '$.repo') || '#' || json_extract(`metadata`, '$.number') || ')'
WHERE `source` IN ('github_issue', 'github_pr', 'github_review')
  AND json_extract(`metadata`, '$.repo') IS NOT NULL
  AND json_extract(`metadata`, '$.number') IS NOT NULL
  AND instr(`title`, ' · ' || json_extract(`metadata`, '$.repo') || '#' || json_extract(`metadata`, '$.number') || ' ') > 0;
