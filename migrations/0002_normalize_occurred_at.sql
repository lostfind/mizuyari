-- Calendar 일정의 시작 시각이 타임존 오프셋 형식(+09:00)으로 저장돼 UTC ISO 와 문자열 비교가 어긋났다.
-- 기존 행을 UTC ISO(…Z)로 맞춘다. 수집기 쪽은 upsert 에서 정규화한다.
UPDATE `activities`
SET `occurred_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `occurred_at`)
WHERE `occurred_at` NOT LIKE '%Z' AND strftime('%Y-%m-%dT%H:%M:%fZ', `occurred_at`) IS NOT NULL;
