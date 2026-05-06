# PRD: X / Threads 북마크 자동 Markdown 저장 Chrome Extension
## 1. 문서 정보
| 항목 | 내용 |
| --- | --- |
| 문서명 | X / Threads Bookmark to Markdown PRD |
| 버전 | v0.1 |
| 작성일 | 2026-05-05 |
| 제품 유형 | Chrome Extension |
| 주요 사용자 | 개인 PKM 사용자, Obsidian 사용자, 개발자, 리서처, 콘텐츠 큐레이터 |
| MVP 플랫폼 | X 우선, Threads 후속 |
| MVP 저장 방식 | File System Access API |
| 기본 실행 방식 | 수동 동기화 |
| 자동 동기화 | 사용자 opt-in |
---
## 2. 제품 개요
이 제품은 사용자가 **x.com** 또는 **threads.net**에서 북마크하거나 저장한 게시물을 감지해, 사용자가 지정한 로컬 폴더에 **Markdown 노트**로 저장하는 Chrome Extension이다.
저장된 Markdown 파일은 Obsidian 사용 여부와 관계없이 개인 지식관리 시스템의 원천 데이터로 활용할 수 있다.
주요 목적은 다음과 같다.
- X / Threads에서 저장한 콘텐츠를 로컬 파일로 소유한다.
- 북마크 콘텐츠를 검색 가능한 Markdown 데이터로 만든다.
- 링크, 태그, 작성자, 원문 URL, 미디어 링크 등 PKM에 필요한 기본 메타데이터를 보존한다.
- 향후 AI 요약, 자동 태깅, 관련 노트 연결, RAG 인덱싱 등으로 확장 가능한 구조를 만든다.
---
## 3. 문제 정의
현재 X와 Threads의 북마크/저장 기능은 플랫폼 내부에 갇혀 있다.
사용자는 다음과 같은 문제를 겪는다.
1. 북마크한 콘텐츠를 로컬에서 검색하기 어렵다.
2. 플랫폼 정책, UI 변경, 계정 문제에 따라 저장한 자료 접근성이 불안정하다.
3. Obsidian, 로컬 검색기, 개인 RAG 시스템, Dataview 등과 직접 연동하기 어렵다.
4. 북마크한 콘텐츠를 정리, 요약, 태깅, 재활용하는 과정이 수동적이다.
5. X / Threads 모두 공식적으로 개인 북마크를 안정적으로 내보내는 기능이 부족하다.
이 제품은 북마크 데이터를 **Markdown 파일 단위의 개인 지식 데이터**로 전환해 위 문제를 해결한다.
---
## 4. 목표
### 4.1 제품 목표
- 사용자가 X 또는 Threads에서 북마크/저장한 게시물을 감지한다.
- 신규 또는 변경된 항목만 추출한다.
- 사용자가 지정한 로컬 폴더에 Markdown 파일로 저장한다.
- 중복 저장을 방지한다.
- 기본 메타데이터와 본문, 미디어 링크, 외부 링크를 보존한다.
- 향후 AI 요약, 태그 추천, 관련 노트 연결 기능을 추가할 수 있는 구조를 만든다.
### 4.2 MVP 목표
MVP의 목표는 완전 자동화가 아니라 **신뢰 가능한 수동 저장 플로우**를 먼저 만드는 것이다.
MVP 성공 기준은 다음과 같다.
> 사용자가 X 북마크 페이지를 열고 Popup의 수동 동기화 버튼을 누르면, 현재 페이지에서 감지 가능한 신규 북마크 항목이 사용자가 선택한 로컬 폴더에 Markdown 파일로 저장된다.
### 4.3 비목표
MVP에서는 다음을 하지 않는다.
- 로그인 우회
- 비공식 인증 탈취
- 계정 쿠키 외부 전송
- 서버 기반 크롤링
- 사용자가 로드하지 않은 전체 과거 북마크 자동 백필
- AI 요약/자동 분류
- 모든 브라우저 지원
- 모든 OS별 네이티브 앱 제공
- X / Threads 내부 비공개 API에 강하게 의존하는 구조
---
## 5. 사용자 시나리오
### 5.1 기본 사용자 시나리오
1. 사용자가 Chrome Extension을 설치한다.
2. Options Page에서 로컬 저장 폴더를 선택한다.
3. 사용자가 X 북마크 페이지를 연다.
4. Popup을 열고 `현재 페이지 저장` 버튼을 누른다.
5. Extension이 현재 페이지의 북마크 항목을 추출한다.
6. 신규 항목만 Markdown 파일로 저장한다.
7. Popup에서 저장 결과를 확인한다.
8. 사용자는 로컬 폴더 또는 Obsidian에서 저장된 Markdown 파일을 확인한다.
### 5.2 장시간 탭 오픈 시나리오
1. 사용자가 X 북마크 페이지를 핀 탭으로 열어둔다.
2. 페이지에 신규 북마크 항목이 로딩된다.
3. 자동 동기화가 켜져 있는 경우 MutationObserver가 DOM 변화를 감지한다.
4. 신규 항목만 큐에 넣고 저장한다.
5. 권한이 만료된 경우 큐에 보관하고 Popup에 재승인 필요 상태를 표시한다.
### 5.3 권한 만료 시나리오
1. 사용자가 이전에 로컬 폴더 권한을 승인했다.
2. 브라우저 재시작 또는 정책 변경으로 권한이 만료된다.
3. Extension이 저장 전 `queryPermission()`으로 권한 상태를 확인한다.
4. 권한이 없는 경우 파일 쓰기를 시도하지 않는다.
5. 저장 대상 항목은 큐에 보관한다.
6. Popup 또는 Options Page에서 재승인을 유도한다.
7. 재승인 후 큐를 flush한다.
### 5.4 북마크 해제 시나리오
1. 사용자가 X / Threads에서 특정 게시물의 북마크를 해제한다.
2. Extension이 해제 상태를 감지한다.
3. 기존 Markdown 파일은 삭제하지 않는다.
4. 해당 파일의 frontmatter에 `archived: true`, `archived_at`을 추가한다.
5. 사용자는 로컬 검색, Dataview, 자체 인덱서에서 archived 항목을 필터링할 수 있다.
---
## 6. MVP 범위
## 6.1 지원 플랫폼
### Phase 1 MVP
- X
  - `https://x.com/i/bookmarks`
  - `https://twitter.com/i/bookmarks`
### Phase 1.5 또는 Phase 2
- Threads
  - `https://www.threads.net/`
  - 저장됨/북마크에 해당하는 페이지 또는 관련 응답 기반 수집
---
## 6.2 MVP 핵심 기능
### 필수 기능
- X 북마크 페이지 감지
- 현재 페이지에 렌더링된 게시물 추출
- 신규 항목 감지
- 중복 저장 방지
- 사용자가 선택한 로컬 폴더에 Markdown 저장
- 기본 Markdown frontmatter 생성
- 기본 저장 경로 생성
- 파일명 slugify 처리
- Popup에서 수동 저장 실행
- Options Page에서 로컬 폴더 선택
- 저장 상태 및 에러 표시
- 큐 영속화
- File System Access API 권한 확인
### 선택 기능
- 자동 동기화 opt-in
- MutationObserver 기반 신규 DOM 감지
- visibilitychange 기반 재수집
- 저장 실패 항목 재시도
- 간단한 에러 로그 UI
---
## 6.3 MVP 제외 범위
- AI 요약
- 자동 태그 추천
- 관련 노트 링크 추천
- 전체 과거 북마크 자동 백필
- Native Messaging Host
- Companion App
- 서버 저장
- 클라우드 동기화
- Obsidian 전용 기능
- 브라우저 간 동기화
- 모바일 브라우저 지원
- 이미지 파일 다운로드
- 첨부 파일 로컬 저장
- X / Threads 로그인 자동화
- CAPTCHA 우회
- 비공식 인증정보 수집
---
## 7. 제품 요구사항
## 7.1 Content Script
### 역할
Content Script는 X / Threads 페이지에서 실행되며, 북마크 또는 저장 항목을 감지하고 게시물 데이터를 추출한다.
### 요구사항
- X 북마크 페이지에서만 활성화되어야 한다.
- DOM 변화 감지를 위해 MutationObserver를 사용할 수 있어야 한다.
- MVP에서는 사용자가 수동 동기화 버튼을 눌렀을 때 현재 DOM에서 항목을 추출한다.
- Phase 2에서는 자동 동기화가 켜진 경우 DOM 변화를 감지해 신규 항목을 추출한다.
- 수집 완료 후 DOM 노드 참조를 유지하지 않아야 한다.
- 추출된 데이터는 표준 `BookmarkItem` 모델로 변환해야 한다.
- 플랫폼별 Extractor와 분리되어야 한다.
### 수용 기준
- X 북마크 페이지에서 현재 렌더링된 게시물 1개 이상을 추출할 수 있다.
- 추출 결과에 URL, 본문, 작성자 정보 중 가능한 값이 포함된다.
- Content Script가 DOM 노드 참조를 장기간 보관하지 않는다.
---
## 7.2 Extractor
### 역할
Extractor는 플랫폼별 DOM 또는 네트워크 응답을 표준 데이터 모델로 변환한다.
### MVP 전략
- X는 DOM 기반 Extractor를 우선 구현한다.
- 네트워크 응답 기반 추출은 Phase 2에서 보조 전략으로 검토한다.
- Threads는 Phase 1.5 또는 Phase 2에서 별도 Extractor로 구현한다.
### 요구사항
- 게시물 ID를 우선 추출해야 한다.
- ID 추출 실패 시 URL hash를 fallback ID로 사용해야 한다.
- 본문 텍스트를 추출해야 한다.
- 작성자 이름 또는 핸들을 추출해야 한다.
- 원문 URL을 추출해야 한다.
- 미디어 URL이 있으면 수집해야 한다.
- 외부 링크가 있으면 수집해야 한다.
- createdAt을 얻을 수 있으면 저장해야 한다.
- 추출 실패 시 전체 동기화를 중단하지 않고 해당 항목만 skip하거나 partial item으로 처리해야 한다.
### 수용 기준
- X 게시물에서 안정적인 `id` 또는 fallback hash를 생성할 수 있다.
- 동일 게시물은 여러 번 추출되어도 동일한 dedup key를 가진다.
- DOM 구조 변경에 대비해 selector가 모듈화되어 있다.
---
## 7.3 Background Service Worker
### 역할
Background Service Worker는 Content Script에서 전달받은 항목을 처리하고, 중복 확인, 저장 큐 관리, Markdown 생성, 로컬 저장을 담당한다.
### 요구사항
- Content Script로부터 `BookmarkItem[]`을 수신해야 한다.
- 각 항목의 dedup key를 계산해야 한다.
- 신규 항목만 저장 큐에 추가해야 한다.
- 변경된 항목은 업데이트 큐에 추가해야 한다.
- 큐와 진행 상태는 `chrome.storage.local`에 즉시 저장해야 한다.
- MV3 service worker 종료 후 재시작되어도 큐를 복원해야 한다.
- 저장 전 File System Access API 권한 상태를 확인해야 한다.
- 저장 실패 시 Exponential Backoff를 적용해야 한다.
- 최대 재시도 실패 후 항목을 pending queue에 보관해야 한다.
### 수용 기준
- service worker 재시작 후에도 저장 대기 항목이 유지된다.
- 동일 항목이 중복 저장되지 않는다.
- 저장 실패 항목이 유실되지 않는다.
---
## 7.4 Local File Adapter
### 역할
Local File Adapter는 Markdown 파일을 사용자가 선택한 로컬 폴더에 생성하거나 갱신한다.
### MVP 저장 방식
- File System Access API
### 요구사항
- 사용자가 선택한 root directory handle을 관리해야 한다.
- directory handle은 IndexedDB에 저장해야 한다.
- 저장 전 `queryPermission()`으로 권한 상태를 확인해야 한다.
- 권한이 없는 경우 `requestPermission()`은 사용자 제스처가 있는 Popup 또는 Options Page에서만 호출해야 한다.
- 하위 폴더를 생성할 수 있어야 한다.
- 기존 파일을 덮어쓸 수 있어야 한다.
- 파일 쓰기 실패 시 에러 유형을 반환해야 한다.
### 경로 생성 규칙
기본 경로는 다음과 같다.
```txt
Bookmarks/
  X/
    2026/
      2026-04-30_x_1234567890.md
  Threads/
    2026/
      2026-04-30_threads_abcdef.md

수용 기준

* 사용자가 선택한 폴더 아래에 하위 폴더를 생성할 수 있다.
* Markdown 파일을 생성할 수 있다.
* 동일 파일을 업데이트할 수 있다.
* 권한 만료 시 사용자에게 재승인을 요구한다.

⸻

7.5 Markdown Renderer

역할

Markdown Renderer는 BookmarkItem을 Markdown 문서로 변환한다.

기본 포맷

---
id: "1234567890"
platform: "x"
source_url: "https://x.com/..."
author: "@handle"
author_name: "Author Name"
created_at: "2026-04-30T00:00:00Z"
collected_at: "2026-04-30T08:39:55+09:00"
updated_at:
archived: false
archived_at:
tags:
  - bookmark
  - x
---
# X Bookmark - @handle - 2026-04-30
> 원문 링크: https://x.com/...
본문 내용...
## Media
- https://...
## Links
- https://...

요구사항

* YAML frontmatter를 생성해야 한다.
* 원문 URL을 반드시 포함해야 한다.
* collectedAt은 항상 포함해야 한다.
* createdAt은 추출 가능한 경우 포함해야 한다.
* 미디어 URL이 없으면 Media 섹션을 생략할 수 있다.
* 외부 링크가 없으면 Links 섹션을 생략할 수 있다.
* 본문이 없는 경우에도 최소 메타데이터 파일은 생성 가능해야 한다.
* 업데이트 시 updated_at을 기록해야 한다.
* 북마크 해제 감지 시 archived: true, archived_at을 기록해야 한다.

수용 기준

* 생성된 Markdown이 Obsidian에서 정상적으로 열린다.
* frontmatter가 YAML 파서에서 깨지지 않는다.
* 본문에 특수문자가 있어도 Markdown이 깨지지 않는다.

⸻

7.6 Dedup & Sync State

역할

중복 저장을 방지하고, 기존 항목의 변경 여부를 판단한다.

저장 키

* 1차 키: 플랫폼 게시물 ID
* fallback 키: URL hash
* 보조 키: source URL

요구사항

* id 기반 dedup을 우선 적용해야 한다.
* id가 없으면 URL hash를 사용해야 한다.
* dedup 테이블에는 id와 URL hash를 함께 저장해야 한다.
* 본문, 작성자, 미디어 URL, 외부 링크를 기준으로 content hash를 계산해야 한다.
* content hash가 달라지면 기존 파일을 업데이트해야 한다.
* 저장된 파일 경로를 state에 기록해야 한다.

예시 상태 구조

type SyncRecord = {
  platform: "x" | "threads"
  id: string
  urlHash: string
  sourceUrl: string
  contentHash: string
  filePath: string
  firstCollectedAt: string
  lastCollectedAt: string
  lastUpdatedAt?: string
  archived?: boolean
  archivedAt?: string
}

수용 기준

* 같은 게시물이 여러 번 수집되어도 파일은 1개만 생성된다.
* 내용이 바뀐 경우 기존 파일이 업데이트된다.
* ID가 없더라도 URL hash로 중복을 방지한다.

⸻

7.7 Options Page

역할

사용자가 저장 위치와 동기화 방식을 설정하는 화면이다.

MVP 설정 항목

* 로컬 root 폴더 선택
* 권한 상태 확인
* 권한 재승인
* 저장 하위 폴더 설정
* 자동 동기화 opt-in
* 파일명 템플릿 확인
* 큐 상태 확인
* 실패 항목 재시도

기본값

type UserSettings = {
  rootFolderGranted: boolean
  basePath: "Bookmarks"
  autoSync: false
  filenameTemplate: "{date}_{platform}_{id}.md"
  archiveOnUnbookmark: true
}

수용 기준

* 사용자가 로컬 폴더를 선택할 수 있다.
* 권한이 만료된 경우 재승인할 수 있다.
* 자동 동기화는 기본값이 꺼져 있다.
* 설정은 브라우저 재시작 후에도 유지된다.

⸻

7.8 Popup Page

역할

현재 페이지의 동기화 상태를 보여주고, 수동 동기화를 실행하는 간단한 UI다.

MVP 기능

* 현재 플랫폼 감지
* 현재 페이지가 지원 대상인지 표시
* 수동 동기화 버튼
* 최근 저장 결과 표시
* 실패 항목 개수 표시
* 로컬 저장 권한 상태 표시
* 재승인 버튼
* 실패 항목 재시도 버튼

상태 예시

* 지원되는 페이지입니다.
* 지원되지 않는 페이지입니다.
* 로컬 저장 폴더 권한이 필요합니다.
* 저장 중입니다.
* 3개 항목이 저장되었습니다.
* 신규 항목이 없습니다.
* 2개 항목 저장에 실패했습니다.
* 재로그인이 필요합니다.

수용 기준

* 사용자가 Popup에서 수동 저장을 실행할 수 있다.
* 저장 결과가 명확히 표시된다.
* 권한 문제 발생 시 사용자가 다음 행동을 알 수 있다.

⸻

8. 데이터 모델

8.1 BookmarkItem

type BookmarkItem = {
  /**
   * 플랫폼별 고유 식별자.
   * X는 tweet/status ID, Threads는 post ID를 우선 사용한다.
   * 확보 불가 시 URL hash를 fallback으로 사용한다.
   */
  id: string
  platform: "x" | "threads"
  url: string
  authorName?: string
  authorHandle?: string
  contentText: string
  createdAt?: string
  collectedAt: string
  mediaUrls?: string[]
  externalLinks?: string[]
  raw?: unknown
}

8.2 SyncRecord

type SyncRecord = {
  platform: "x" | "threads"
  id: string
  urlHash: string
  sourceUrl: string
  contentHash: string
  filePath: string
  firstCollectedAt: string
  lastCollectedAt: string
  lastUpdatedAt?: string
  archived?: boolean
  archivedAt?: string
}

8.3 SyncQueueItem

type SyncQueueItem = {
  queueId: string
  item: BookmarkItem
  action: "create" | "update" | "archive"
  status: "pending" | "processing" | "failed"
  retryCount: number
  nextRetryAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

8.4 UserSettings

type UserSettings = {
  basePath: string
  autoSync: boolean
  filenameTemplate: string
  archiveOnUnbookmark: boolean
  maxRetryCount: number
  retryBackoffMs: number[]
}

⸻

9. 저장 경로 및 파일명 정책

9.1 기본 저장 경로

Bookmarks/
  X/
    2026/
      2026-04-30_x_1234567890.md
  Threads/
    2026/
      2026-04-30_threads_abcdef.md

9.2 파일명 규칙

기본 템플릿은 다음과 같다.

{date}_{platform}_{id}.md

예시:

2026-04-30_x_1234567890.md
2026-04-30_threads_abcd1234.md

9.3 slugify 규칙

파일명 생성 시 다음 규칙을 적용한다.

* Unicode NFKC 정규화
* 공백은 _로 변환
* /, \, :, *, ?, ", <, >, | 제거 또는 -로 치환
* 연속된 _ 또는 -는 하나로 축약
* 파일명 최대 길이 제한
* 게시물 ID가 있으면 제목보다 ID를 우선 사용
* authorHandle 포함 템플릿은 Phase 3에서 지원

⸻

10. 동기화 전략

10.1 신규 감지

MVP에서는 사용자가 Popup에서 수동 동기화를 실행할 때 현재 페이지의 DOM에서 항목을 추출한다.

Phase 2에서는 다음 트리거를 추가한다.

* MutationObserver
* visibilitychange
* soft refresh polling
* 사용자가 스크롤로 추가 로딩한 항목 감지

10.2 변경 감지

동일 ID 항목에 대해 다음 값을 기반으로 content hash를 계산한다.

* contentText
* authorName
* authorHandle
* mediaUrls
* externalLinks
* source URL

content hash가 기존 값과 다르면 기존 Markdown 파일을 업데이트한다.

업데이트 시 frontmatter에 다음 값을 기록한다.

updated_at: "2026-05-05T22:00:00+09:00"

10.3 삭제 또는 북마크 해제 감지

북마크 해제된 항목은 삭제하지 않는다.

대신 frontmatter를 다음과 같이 갱신한다.

archived: true
archived_at: "2026-05-05T22:00:00+09:00"

이 정책의 목적은 PKM 히스토리를 보존하는 것이다.

10.4 실패 처리

파일 쓰기 실패 시 다음 순서로 처리한다.

1. 에러 유형 확인
2. 권한 문제인지 판단
3. 권한 문제라면 자동 재시도 중단
4. 일반 쓰기 실패라면 Exponential Backoff 적용
5. 최대 재시도 실패 후 pending queue에 보관
6. Popup에 실패 상태 표시
7. 사용자가 재시도 버튼을 누르면 큐 flush

10.5 Exponential Backoff

기본 재시도 정책은 다음과 같다.

1초 → 2초 → 4초 → 8초

최대 4회 재시도한다.

권한 만료, directory handle invalid, user denied permission은 자동 재시도하지 않는다.

10.6 큐 영속화

Manifest V3 service worker는 idle 상태에서 종료될 수 있으므로, 모든 큐와 진행 상태는 즉시 chrome.storage.local에 저장한다.

요구사항:

* 큐 추가 즉시 persist
* 상태 변경 즉시 persist
* service worker 재기동 시 큐 복원
* 처리 중이던 항목은 pending 상태로 되돌림
* 중복 큐 삽입 방지

⸻

11. 메모리 관리

X와 Threads는 무한 스크롤 기반 UI이므로 장시간 탭을 열어두면 DOM 노드가 계속 누적될 수 있다.

Extension은 다음 원칙을 따른다.

* 수집 완료 후 DOM 참조를 보관하지 않는다.
* 게시물 데이터는 plain object로 변환한 뒤 전달한다.
* MutationObserver는 전체 document가 아니라 북마크 리스트 root 근처에만 attach한다.
* 누적 ID 캐시는 임계치 초과 시 LRU 방식으로 정리한다.
* content script 내부 state는 최소화한다.
* service worker state는 in-memory에 의존하지 않는다.

⸻

12. 권한 설계

12.1 Manifest 권한 초안

{
  "manifest_version": 3,
  "name": "Bookmark to Markdown",
  "version": "0.1.0",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://x.com/*",
    "https://twitter.com/*",
    "https://www.threads.net/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://x.com/*",
        "https://twitter.com/*",
        "https://www.threads.net/*"
      ],
      "js": ["content-script.js"]
    }
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html"
}

12.2 권한 원칙

* MVP에서는 최소 권한을 사용한다.
* storage는 필수다.
* host_permissions는 X / Threads로 제한한다.
* activeTab은 수동 트리거 설계에 필요한지 Phase 0에서 재검토한다.
* scripting은 가능하면 사용하지 않는다.
* File System Access API는 별도 manifest permission 없이 사용자 제스처 기반으로 권한을 얻는다.
* 계정 비밀번호, 쿠키, 인증 토큰을 외부로 전송하지 않는다.

⸻

13. 로컬 저장 방식 의사결정

13.1 후보 비교

방식	장점	단점	적용 단계
File System Access API	별도 앱 없이 로컬 폴더 저장 가능	최초 권한 승인 필요, 권한 만료 가능	MVP
Native Messaging Host	임의 절대 경로 저장, 대량 처리 강함	설치 복잡, OS별 패키징 필요	확장 단계
Local Companion App	로컬 파일 제어 강력, 데스크톱 UX 가능	별도 앱 설치/실행 필요, 보안 설계 필요	고급 확장
Downloads API	구현 쉬움	Downloads 폴더 기준 상대 경로만 가능	프로토타입 보조

13.2 MVP 결정

MVP에서는 File System Access API를 기본 저장 방식으로 사용한다.

단, Phase 0에서 다음 검증을 통과해야 한다.

* Chrome Extension 환경에서 폴더 선택 가능
* directory handle 저장 가능
* 브라우저 재시작 후 handle 복원 가능
* 권한 상태 확인 가능
* 파일 생성 가능
* 파일 덮어쓰기 가능
* 하위 폴더 생성 가능

실패 시 대체안으로 Native Messaging Host 또는 Local Companion App을 검토한다.

⸻

14. 아키텍처

14.1 전체 구조

flowchart LR
  A[Content Script<br>x.com / threads.net] --> B[DOM / Network Observer]
  B --> C[Post Extractor]
  C --> D[Background Service Worker]
  D --> E[Dedup & Sync State<br>chrome.storage]
  D --> F[Markdown Renderer]
  F --> G[Local File Adapter]
  G --> H[File System Access API]
  H --> I[User-selected Local Folder]

14.2 모듈 구조 예시

src/
  background/
    index.ts
    queue.ts
    sync-state.ts
  content/
    index.ts
    observer.ts
  extractors/
    x.extractor.ts
    threads.extractor.ts
    types.ts
  markdown/
    renderMarkdown.ts
    frontmatter.ts
  storage/
    chromeStorage.ts
    indexedDbHandles.ts
  file/
    localFileAdapter.ts
    pathBuilder.ts
    slugify.ts
  popup/
    Popup.tsx
  options/
    Options.tsx
  shared/
    types.ts
    hash.ts
    date.ts
    errors.ts

⸻

15. UI 요구사항

15.1 Popup

주요 정보

* 현재 페이지 지원 여부
* 로컬 저장 권한 상태
* 최근 동기화 결과
* 실패 큐 개수
* 수동 저장 버튼
* 재승인 버튼
* 재시도 버튼

버튼

버튼	동작
현재 페이지 저장	현재 DOM에서 북마크 항목 추출 후 저장
저장 폴더 권한 승인	File System Access API 권한 요청
실패 항목 재시도	pending queue flush
설정 열기	Options Page 이동

상태 문구 예시

지원되는 X 북마크 페이지입니다.
로컬 저장 폴더 권한이 필요합니다.
저장 중입니다.
3개 항목이 저장되었습니다.
신규 항목이 없습니다.
2개 항목 저장에 실패했습니다.
재로그인이 필요합니다.

⸻

15.2 Options Page

설정 항목

* 로컬 저장 폴더 선택
* 현재 권한 상태
* 저장 root path
* 저장 하위 폴더명
* 파일명 템플릿
* 자동 동기화 on/off
* archived 정책 on/off
* 실패 큐 확인
* 실패 큐 재시도
* 로그 초기화

UX 원칙

* 자동 동기화는 기본값 off
* 사용자가 명시적으로 켜야 함
* 저장 위치는 사용자가 직접 선택해야 함
* 권한이 끊기면 명확하게 재승인을 요구해야 함
* 예상치 못한 파일 생성을 방지해야 함

⸻

16. 비기능 요구사항

16.1 보안

* 계정 비밀번호를 저장하지 않는다.
* 쿠키를 외부 서버로 전송하지 않는다.
* 수집 데이터는 기본적으로 로컬에만 저장한다.
* 외부 서버와 통신하지 않는다.
* 로컬 저장 root 밖에는 파일을 쓰지 않는다.
* Companion App 도입 시 인증 토큰과 root 제한을 필수로 설계한다.

16.2 개인정보

* 게시물 원문, 작성자, 링크, 미디어 URL은 사용자의 로컬 폴더에만 저장한다.
* Extension은 분석 이벤트를 외부로 보내지 않는다.
* 원격 로그 수집은 MVP에서 제공하지 않는다.

16.3 성능

* 수동 동기화 시 현재 로드된 항목만 처리한다.
* 대량 저장 시 큐 기반으로 순차 처리한다.
* DOM 참조를 장기간 보관하지 않는다.
* MutationObserver 범위를 최소화한다.
* 파일 쓰기는 backoff와 queue를 통해 제어한다.

16.4 안정성

* service worker 종료 후에도 큐가 유지되어야 한다.
* 저장 실패 항목은 유실되지 않아야 한다.
* 권한 만료 시 사용자 재승인 후 재처리 가능해야 한다.
* 플랫폼 DOM 변경 시 extractor 단위로 수정 가능해야 한다.

16.5 호환성

MVP 검증 대상:

* Chrome 최신 안정 버전
* Edge 최신 안정 버전
* macOS
* Windows

추후 검토:

* Linux
* Brave
* Arc
* Firefox

⸻

17. 테스트 전략

17.1 Unit Test

대상:

* slugify
* pathBuilder
* hash 생성
* markdown renderer
* dedup key 생성
* sync state 업데이트
* retry backoff 계산

도구:

* Vitest

17.2 Fixture Test

대상:

* X DOM snapshot
* Threads DOM snapshot
* 게시물 ID 추출
* 본문 추출
* 작성자 추출
* 미디어 링크 추출
* 외부 링크 추출

도구:

* Playwright
* 저장된 HTML fixture

17.3 E2E Test

시나리오:

1. Extension 로드
2. X 북마크 fixture 페이지 접속
3. Popup 수동 저장 클릭
4. Markdown 생성 확인
5. 중복 저장 방지 확인
6. 내용 변경 시 업데이트 확인
7. 권한 실패 시 큐 보관 확인

도구:

* Playwright
* Chrome Extension test environment

17.4 수동 QA

체크리스트:

* X 북마크 페이지에서 저장 가능
* 저장 폴더 선택 가능
* 하위 폴더 생성 가능
* Markdown 파일 생성 가능
* 브라우저 재시작 후 권한 상태 확인 가능
* 권한 만료 시 재승인 가능
* 동일 게시물 중복 저장 방지
* 실패 항목 재시도 가능

⸻

18. 개발 단계

18.1 Phase 0: 검증 프로토타입

목표

Chrome Extension 환경에서 핵심 기술 제약을 검증한다.

작업 항목

* X 북마크 페이지에서 DOM 기반 게시물 1개 추출
* Threads 저장 페이지에서 DOM 구조 확인
* Popup 클릭으로 Content Script에 추출 요청
* File System Access API로 폴더 선택
* IndexedDB에 directory handle 저장
* Markdown 테스트 파일 생성
* 하위 폴더 생성
* 파일 덮어쓰기 테스트
* 권한 상태 확인 테스트

Go / No-Go 기준

Go 조건:

* 사용자가 선택한 로컬 폴더에 Markdown 파일 생성 가능
* 하위 폴더 생성 가능
* 권한 상태 확인 가능
* 브라우저 재시작 후 handle 복원 가능
* Popup 클릭 한 번으로 현재 항목 1개 저장 가능

No-Go 조건:

* Extension 환경에서 directory handle 저장/복원이 불안정
* 파일 생성 또는 하위 폴더 생성이 제한됨
* 사용자 제스처 없이 권한 유지가 불가능해 UX가 크게 깨짐

No-Go 시 대안:

* Native Messaging Host 검토
* Local Companion App 검토
* Downloads API 기반 프로토타입 전환

⸻

18.2 Phase 1: MVP

목표

X 북마크를 수동으로 Markdown 저장할 수 있는 MVP를 만든다.

작업 항목

* Extension skeleton 생성
* Manifest V3 구성
* X Extractor 구현
* BookmarkItem 표준 모델 정의
* Markdown Renderer 구현
* Local File Adapter 구현
* slugify 구현
* Dedup & Sync State 구현
* Queue persist 구현
* Popup 수동 저장 버튼 구현
* Options Page 저장 폴더 선택 구현
* 권한 상태 확인 및 재승인 구현
* 기본 에러 표시 구현
* Playwright snapshot fixture 생성
* File System Access API 호환성 매트릭스 작성

성공 기준

* X 북마크 페이지에서 수동 저장 가능
* 신규 항목만 저장
* 중복 저장 방지
* 사용자가 지정한 로컬 폴더에 Markdown 파일 생성
* 권한 만료 시 재승인 가능
* service worker 재시작 후 큐 유지

⸻

18.3 Phase 1.5: Threads 기본 지원

목표

Threads 저장 항목을 수동으로 Markdown 저장할 수 있게 한다.

작업 항목

* Threads 저장 페이지 구조 조사
* Threads Extractor 구현
* Threads ID 추출 규칙 정의
* URL hash fallback 검증
* Markdown 저장 경로에 Threads 분기 추가
* Threads fixture 생성

성공 기준

* Threads 저장 페이지에서 수동 저장 가능
* 신규 항목만 저장
* X와 동일한 Markdown 포맷으로 저장

⸻

18.4 Phase 2: 자동화 강화

목표

사용자가 페이지를 열어둔 상태에서 신규 항목을 더 안정적으로 감지한다.

작업 항목

* MutationObserver 적용
* 북마크 리스트 root 탐색
* visibilitychange 재수집
* soft refresh polling 옵션 검토
* 네트워크 응답 기반 추출 검토
* 저장 큐 retry 강화
* 파일 업데이트 지원
* archived 정책 구현
* 세션 만료 감지

성공 기준

* 스크롤로 추가 로딩된 항목 저장 가능
* 자동 동기화 opt-in 시 신규 항목 감지 가능
* 권한 실패 항목이 큐에 보관됨
* 재승인 후 큐 flush 가능

⸻

18.5 Phase 3: 품질 개선

목표

사용성과 안정성을 개선한다.

작업 항목

* 에러 로그 UI
* 파일명 템플릿 옵션
* 저장 경로 템플릿 옵션
* 태그 규칙 설정
* 미디어 링크 처리 개선
* selector fixture 관리
* E2E 테스트 추가
* 대량 처리 성능 개선

성공 기준

* 사용자가 파일명과 경로 규칙을 조정할 수 있음
* 에러 원인과 해결 방법을 UI에서 확인 가능
* DOM 변경에 대한 회귀 테스트 가능

⸻

18.6 Phase 4: PKM 확장

목표

저장된 Markdown을 개인 지식관리 데이터로 확장한다.

작업 항목

* AI 요약 필드 추가
* 자동 태그 추천
* 관련 노트 후보 생성
* 로컬 인덱서 연동
* Obsidian Dataview 친화 필드 추가
* Readwise adapter 검토
* Notion adapter 검토
* Local RAG pipeline 연동 검토

성공 기준

* Markdown 노트에 요약과 추천 태그 추가 가능
* 저장된 북마크를 PKM 워크플로우에 쉽게 연결 가능
* 외부 저장소 adapter 확장 가능

⸻

19. 첫 스프린트 작업 목록

19.1 Sprint 1 목표

X 북마크 페이지에서 현재 보이는 게시물 1개 이상을 사용자가 선택한 로컬 폴더에 Markdown 파일로 저장하는 검증 가능한 프로토타입을 만든다.

19.2 작업 목록

* Chrome Extension skeleton 생성
* Manifest V3 최소 권한 구성
* Popup 기본 UI 생성
* Options Page 기본 UI 생성
* File System Access API 폴더 선택 구현
* IndexedDB directory handle 저장 구현
* 권한 상태 확인 구현
* X 북마크 페이지 DOM 조사
* X 게시물 1개 추출 구현
* BookmarkItem 타입 정의
* URL hash fallback 구현
* Markdown Renderer 구현
* slugify 구현
* 기본 pathBuilder 구현
* Local File Adapter 구현
* Popup 수동 저장 버튼 구현
* 저장 성공/실패 상태 표시
* Playwright snapshot fixture 생성
* MVP 데모 시나리오 작성

19.3 Sprint 1 완료 기준

* 사용자가 X 북마크 페이지를 연다.
* Popup에서 수동 저장 버튼을 누른다.
* 현재 보이는 게시물 중 최소 1개가 추출된다.
* 사용자가 선택한 로컬 폴더에 Markdown 파일이 생성된다.
* 같은 항목을 다시 저장해도 중복 파일이 생성되지 않는다.
* 저장 실패 시 에러가 Popup에 표시된다.

⸻

20. 예상 리스크와 대응

리스크	영향	대응
X DOM 구조 변경	Extractor 깨짐	selector 모듈화, fixture 기반 테스트
Threads DOM 구조 불안정	Threads 지원 지연	X 먼저 MVP 구현, Threads는 Phase 1.5로 분리
비공식 API 구조 변경	네트워크 기반 추출 불안정	DOM 기반 MVP 후 네트워크는 보조 전략
로컬 파일 쓰기 제한	저장 실패	File System Access API Phase 0 검증, 실패 시 Native Messaging 대안
폴더 권한 만료	자동 저장 중단	queryPermission 확인, 재승인 UX 제공
service worker 종료	큐 유실	모든 큐를 chrome.storage.local에 즉시 persist
대량 북마크 처리	성능 저하	현재 로드된 항목만 처리, 큐 기반 순차 저장
파일명 특수문자	저장 실패	slugify 규칙 적용
사용자 의도와 다르게 자동 저장	신뢰 저하	자동 동기화 기본 off, opt-in 방식
세션 만료	수집 실패	401/403 감지, 재로그인 필요 상태 표시
Web Store 심사	배포 지연	최소 권한, 외부 전송 없음, 명확한 개인정보 정책

⸻

21. 기술 스택

21.1 Extension

* Manifest V3
* TypeScript
* Vite 또는 Plasmo

21.2 UI

* React
* Tailwind CSS

또는 MVP에서는 기본 HTML/CSS로 시작 가능하다.

21.3 Storage

* chrome.storage.local
* IndexedDB
    * DirectoryHandle 저장용

21.4 File

* File System Access API

21.5 Test

* Vitest
* Playwright

21.6 Optional Future

* Native Messaging Host
* Local Companion App
* Localhost API
* Obsidian integration
* Local RAG indexer
* Readwise adapter
* Notion adapter

⸻

22. 성공 지표

22.1 MVP 성공 지표

* X 북마크 수동 저장 성공률 95% 이상
* 동일 항목 중복 저장률 1% 이하
* 저장 실패 항목 유실률 0%
* Markdown 생성 파일이 Obsidian에서 정상 열림
* 사용자가 저장 폴더를 직접 선택하고 재승인할 수 있음

22.2 Phase 2 성공 지표

* 무한 스크롤로 추가 로딩된 항목 저장 가능
* 자동 동기화 opt-in 사용자 기준 신규 항목 감지 성공률 90% 이상
* 권한 만료 시 사용자 재승인 후 큐 flush 성공
* 장시간 탭 유지 시 메모리 증가가 과도하지 않음

22.3 장기 성공 지표

* 저장된 Markdown을 Obsidian, 로컬 검색, RAG pipeline에서 활용 가능
* AI 요약/태그 추천 추가 시 기존 Markdown 구조 유지 가능
* X / Threads 외 플랫폼 adapter 확장 가능

⸻

23. 주요 의사결정

23.1 MVP 시작 방식

결정: 수동 동기화 버튼을 기본으로 한다.

자동 감지는 opt-in으로 제공한다.

이유:

* 예상치 못한 파일 생성을 방지한다.
* 사용자 신뢰를 확보한다.
* Web Store 심사 리스크를 낮춘다.
* 기술 검증 범위를 줄인다.

23.2 로컬 저장 방식

결정: File System Access API를 MVP 기본 방식으로 사용한다.

이유:

* 별도 네이티브 앱 설치가 필요 없다.
* 사용자가 직접 선택한 로컬 폴더에 저장할 수 있다.
* MVP 구현 속도가 빠르다.

단, Phase 0 검증 실패 시 Native Messaging Host 또는 Local Companion App으로 전환한다.

23.3 파일 저장 단위

결정: 게시물당 1개 Markdown 파일로 저장한다.

이유:

* 링크 단위 관리가 쉽다.
* Obsidian graph view와 잘 맞는다.
* Dataview 등으로 일자별 조회가 가능하다.
* 업데이트와 archived 처리 단위가 명확하다.

23.4 플랫폼 우선순위

결정: X를 먼저 구현한다.

이유:

* DOM/API 사례가 Threads보다 상대적으로 많다.
* 북마크 페이지가 명확하다.
* Phase 0 검증에 적합하다.

Threads는 Phase 1.5 또는 Phase 2로 이관한다.

23.5 메타데이터 최소 범위

결정: MVP에서는 다음 필드를 유지한다.

* platform
* source_url
* author
* author_name
* created_at
* collected_at
* updated_at
* archived
* archived_at
* tags
* 본문
* media
* links

AI 요약과 자동 분류는 Phase 4에서 추가한다.

⸻

24. Open Questions

아래 항목은 Phase 0 또는 Sprint 1 중 확정한다.

1. Chrome Extension에서 File System Access API directory handle 저장/복원이 충분히 안정적인가?
2. activeTab 권한 없이 content_scripts 선언만으로 MVP 수동 저장을 구현할 수 있는가?
3. X 북마크 페이지에서 가장 안정적인 게시물 ID 추출 방식은 무엇인가?
4. Threads 저장 페이지의 안정적인 URL/ID 구조는 무엇인가?
5. 자동 동기화 opt-in 시 polling 주기를 제공할 것인가?
6. archived 상태 감지는 MVP에 포함할 것인가, Phase 2로 미룰 것인가?
7. 파일 업데이트 시 기존 사용자 편집 내용을 보존할 전략이 필요한가?
8. media URL만 저장할 것인가, 향후 파일 다운로드 옵션도 제공할 것인가?
9. Markdown frontmatter 필드명을 Obsidian Dataview 친화적으로 더 조정할 것인가?

⸻

25. 권장 구현 순서

1. Extension skeleton 생성
2. Popup → Content Script 메시지 연결
3. X DOM에서 게시물 1개 추출
4. BookmarkItem 모델 변환
5. Options에서 로컬 폴더 선택
6. DirectoryHandle 저장/복원 검증
7. Markdown Renderer 구현
8. Local File Adapter 구현
9. Popup 수동 저장 구현
10. Dedup state 구현
11. Queue persist 구현
12. 에러 상태 UI 구현
13. Playwright fixture 추가
14. X 다중 게시물 저장 구현
15. Phase 1 MVP 데모

⸻

26. MVP 데모 시나리오

사전 조건

* Chrome Extension이 설치되어 있다.
* 사용자가 Options Page에서 로컬 저장 폴더를 선택했다.
* 사용자가 X에 로그인되어 있다.
* 사용자가 X 북마크 페이지를 열었다.

데모 플로우

1. 사용자가 https://x.com/i/bookmarks에 접속한다.
2. Popup을 연다.
3. Popup에 지원되는 X 북마크 페이지입니다. 상태가 표시된다.
4. 사용자가 현재 페이지 저장 버튼을 클릭한다.
5. Extension이 현재 페이지의 북마크 항목을 추출한다.
6. 신규 항목이 queue에 추가된다.
7. Markdown Renderer가 파일 내용을 생성한다.
8. Local File Adapter가 로컬 폴더에 파일을 저장한다.
9. Popup에 3개 항목이 저장되었습니다. 상태가 표시된다.
10. 사용자가 로컬 폴더에서 Markdown 파일을 확인한다.
11. 같은 버튼을 다시 누르면 신규 항목이 없습니다. 상태가 표시된다.

⸻

27. 개인정보 및 보안 정책 초안

이 Extension은 사용자의 X / Threads 북마크 페이지에서 사용자가 직접 접근 가능한 게시물 정보를 추출해 사용자가 선택한 로컬 폴더에 저장한다.

MVP 기준 정책:

* 외부 서버로 데이터를 전송하지 않는다.
* 계정 비밀번호를 저장하지 않는다.
* 쿠키를 수집하거나 외부로 전송하지 않는다.
* 저장 위치는 사용자가 직접 선택한다.
* 저장된 파일은 사용자 로컬 환경에만 존재한다.
* 자동 동기화는 기본적으로 꺼져 있다.
* 사용자가 명시적으로 동의한 경우에만 자동 감지를 수행한다.

⸻

28. 최종 요약

이 제품의 핵심은 X / Threads 북마크를 단순히 백업하는 것이 아니라, 개인이 소유 가능한 Markdown 기반 PKM 데이터로 전환하는 것이다.

MVP에서는 욕심을 줄이고 다음 3가지를 확실하게 검증한다.

1. X 북마크 페이지에서 안정적으로 항목을 추출할 수 있는가?
2. Chrome Extension에서 사용자가 선택한 로컬 폴더에 안정적으로 Markdown을 저장할 수 있는가?
3. 중복, 실패, 권한 만료, service worker 종료 상황에서도 데이터가 유실되지 않는가?

이 3가지가 검증되면 Threads, 자동 감지, AI 요약, 태그 추천, RAG 연동까지 자연스럽게 확장할 수 있다.