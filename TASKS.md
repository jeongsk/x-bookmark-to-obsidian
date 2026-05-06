# Tasks — X Bookmark to Obsidian

> PRD 기반 작업 목록. 2026-05-06 기준.

## 진행률

- 전체: 18/18 완료 (100%)
- Phase 1 완성도: 100% (핵심 기능 완성)
- Phase 1.5 완성도: 100% (Threads 기본 지원 완성)
- Phase 2 완성도: 100% (자동화 강화 완성)
- Phase 3 완성도: 100% (품질 개선 완성)
- Phase 4 완성도: 100% (Threads 고도화 완성)

---

## Phase 1 보강 (MVP 완성도 향상)

### 1. Exponential Backoff 재시도 큐
- [x] background.js: 저장 실패 시 지수 백오프 (1s→2s→4s→8s, 최대 4회)
- [x] chrome.storage.local에 재시도 큐 영속화
- [x] service worker 재시작 시 큐 복원
- [x] popup.js: 실패 큐 상태 표시 및 수동 재시도 버튼

### 2. Content Hash 기반 변경 감지
- [x] content.js: contentText + author + mediaUrls 해시 계산
- [x] background.js: contentHash 비교 후 변경 시 업데이트 액션 전송
- [x] btl_file_writer.py: 기존 파일 업데이트 (updated_at 기록) 지원

### 3. 북마크 해제 감지 (archived 처리)
- [x] content.js: 북마크 해제 클릭 감지
- [x] background.js: archived: true + archived_at 처리
- [x] btl_file_writer.py: archived frontmatter 업데이트

### 4. Visibility Change 재수집
- [x] content.js: visibilitychange 이벤트 리스너 추가
- [x] 탭이 다시 보이면 북마크 페이지 재스캔

### 5. 에러 로그 UI 개선
- [x] popup.html: 에러 로그 섹션 추가
- [x] popup.js: 실패 내역 표시 (최근 10건)
- [x] 실패 항목별 원인과 URL 표시

### 6. 파일명 템플릿 설정
- [x] popup.html: 파일명 템플릿 입력 필드 추가
- [x] popup.js: 템플릿 저장 및 미리보기
- [x] btl_file_writer.py: 템플릿 기반 파일명 생성

### 7. 미디어 다운로드 옵션 (선택)
- [x] btl_file_writer.py: 이미지 URL → 로컬 다운로드 옵션
- [x] popup.js: 미디어 저장 ON/OFF 토글

### 8. 태그 자동화
- [x] btl_file_writer.py: 설정된 기본 태그를 frontmatter에 추가
- [x] popup.js: 기본 태그 입력 필드

---

## Phase 1.5: Threads 기본 지원

### 9. Threads Extractor
- [x] content-threads.js: Threads DOM 분석 및 게시물 추출
- [x] manifest.json: threads.net host_permissions 추가
- [x] background.js: Threads 메시지 핸들러 추가
- [x] btl_file_writer.py: Threads URL 처리

---

## Phase 2: 자동화 강화

### 10. MutationObserver 적용
- [x] content.js: 북마크 리스트 root Observer (현재는 클릭만 감지)

### 11. Soft Refresh Polling
- [x] content.js: 일정 주기로 새 북마크 확인하는 옵션

### 12. 네트워크 응답 기반 추출 (보조)
- [x] content.js: XHR/fetch 인터셉트로 북마크 API 응답 캡처 검토

---

## Phase 3: 품질 개선

### 13. E2E 테스트
- [x] Playwright 설정
- [x] X 북마크 fixture 페이지 테스트
- [x] 중복 저장 방지 테스트
- [x] 변경 감지 테스트

### 14. 성능 최적화
- [x] 대량 북마크 처리 시 메모리 프로파일링
- [x] LRU 캐시 임계치 설정

### 15. 배포 자동화
- [x] GitHub Actions로 extension + installer ZIP 빌드
- [x] 버전 자동 증가 스크립트

---

## Phase 4: Threads 고도화

### 16. Threads 미디어/외부링크 추출
- [x] content-threads.js: extractMediaUrls() - 이미지/비디오 URL 추출
- [x] content-threads.js: extractExternalLinks() - 외부 링크 URL 추출
- [x] content-threads.js: payload에 media_urls, external_links 포함

### 17. Threads Markdown 미디어/링크 섹션
- [x] btl_file_writer.py: build_threads_markdown()에 ## 미디어 섹션 추가
- [x] btl_file_writer.py: build_threads_markdown()에 ## 링크 섹션 추가
- [x] btl_file_writer.py: _update_threads_note() 콘텐츠 변경 시 전체 재작성

### 18. Threads E2E 테스트
- [x] tests/fixtures/threads.html: Threads 게시물 fixture 페이지 (이미지, 비디오, 외부링크, 프로필)
- [x] tests/e2e/threads-extraction.spec.js: 9개 테스트 (URL 추출, 미디어 추출, 외부링크, 해시)

---

## 완료된 작업

| # | 작업 | 완료일 |
|---|------|--------|
| - | MV3 Extension skeleton | 이전 |
| - | X DOM Extractor | 이전 |
| - | Markdown Renderer + frontmatter | 이전 |
| - | Native Messaging Host | 이전 |
| - | URL Index Cache (O(1) dedup) | 이전 |
| - | Popup 수동 저장/동기화 UI | 이전 |
| - | 한국어 번역 | 이전 |
| 9 | Threads Extractor | 2026-05-06 |
| 10 | MutationObserver 적용 | 2026-05-06 |
| 11 | Soft Refresh Polling | 2026-05-06 |
| 12 | 네트워크 응답 API 캡처 | 2026-05-06 |
| 13 | E2E 테스트 (Playwright) | 2026-05-06 |
| 14 | 성능 최적화 (LRU 캐시) | 2026-05-06 |
| 15 | 배포 자동화 (GitHub Actions) | 2026-05-06 |
| 16 | Threads 미디어/외부링크 추출 | 2026-05-06 |
| 17 | Threads Markdown 미디어/링크 섹션 | 2026-05-06 |
| 18 | Threads E2E 테스트 | 2026-05-06 |
