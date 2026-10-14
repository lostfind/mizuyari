# Mizuyari 개인정보처리방침

최종 수정일: 2026-10-14

Mizuyari는 개인이 자신의 업무 활동을 정리하기 위해 직접 배포해 사용하는 1인용 오픈소스 웹앱입니다. 운영자는 곧 사용자 본인이며, 제3자에게 서비스를 제공하지 않습니다.

## 수집하는 정보

사용자가 Google 계정으로 로그인해 권한을 허용하면 다음 정보를 Google API로 읽어 옵니다.

- Google 계정의 이메일 주소, 이름, 프로필 사진 (로그인 식별용)
- Google Tasks의 할 일 목록과 항목 (제목, 메모, 마감일, 완료 여부)
- Google Calendar의 일정 (제목, 시작·종료 시각, 참석 여부)

GitHub에서는 사용자가 등록한 개인 액세스 토큰으로 본인의 Issue, Pull Request, 리뷰 활동을 읽어 옵니다.

## 정보의 사용

수집한 정보는 사용자 본인의 2주 단위 업무 리포트와 분기·반기 성과 정리를 만드는 데만 사용합니다. 광고, 분석, 프로파일링에 사용하지 않으며 제3자에게 제공하거나 판매하지 않습니다.

## Google 사용자 데이터에 대한 쓰기

Google Tasks에 대한 쓰기는 사용자가 앱 화면에서 직접 체크한 할 일을 "완료" 상태로 바꾸는 것 하나뿐입니다. 할 일을 만들거나 수정하거나 삭제하지 않으며, Calendar와 GitHub에는 어떤 쓰기도 하지 않습니다.

## 저장과 보안

- 데이터는 사용자가 소유한 Cloudflare 계정의 D1 데이터베이스에 저장됩니다.
- Google OAuth 토큰은 AES-256-GCM으로 암호화해 저장하며, 암호화 키는 데이터베이스와 분리된 비밀 저장소에 둡니다.
- 앱에 로그인할 수 있는 계정은 배포 시 지정한 이메일 하나뿐입니다.

## 보관과 삭제

데이터는 사용자가 삭제할 때까지 보관됩니다. 사용자는 언제든 Cloudflare 대시보드에서 데이터베이스를 삭제하거나, [Google 계정 권한 설정](https://myaccount.google.com/permissions)에서 Mizuyari의 접근 권한을 철회할 수 있습니다. 권한을 철회하면 저장된 토큰은 더 이상 유효하지 않습니다.

## Google API 서비스 사용자 데이터 정책 준수

Mizuyari가 Google API로 받은 정보의 사용과 다른 앱으로의 전송은 [Google API 서비스 사용자 데이터 정책](https://developers.google.com/terms/api-services-user-data-policy)의 제한적 사용 요건을 포함해 해당 정책을 준수합니다.

## 문의

이 방침에 관한 문의는 [GitHub 저장소](https://github.com/lostfind/mizuyari)의 Issue로 남겨 주세요.
