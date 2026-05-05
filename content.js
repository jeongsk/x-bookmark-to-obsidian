(function () {
  "use strict";

  const PENDING_BY_URL = new Map();
  const RECENT_SUCCESS = new Map();
  const PENDING_TTL_MS = 15000;
  const RECENT_TTL_MS = 30000;
  const CONFIRM_DELAY_MS = 700;
  const SYNC_SCROLL_DELAY_MS = 1200;
  const SYNC_IDLE_ROUNDS = 3;
  const SYNC_MAX_ROUNDS = 40;
  const SYNC_MAX_ITEMS = 200;
  const SYNC_ERROR_SAMPLE_LIMIT = 5;
  const CLEAR_RETRY_LIMIT = 2;
  const TOAST_ID = "x-bookmark-to-obsidian-toast-root";
  const HUD_ID = "x-bookmark-to-obsidian-hud";
  const ACTIVE_RUN_STORAGE_KEY = "activeRunStatus";

  let syncInFlight = false;
  let clearInFlight = false;
  let hudDismissed = false;

  document.addEventListener("click", handleDocumentClick, true);
  hydrateHudFromActiveRun();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "START_BOOKMARK_PAGE_SYNC") {
      syncBookmarkTimeline(message.options || {})
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => sendResponse({ success: false, error: error.message || "동기화 실패" }));
      return true;
    }

    if (message?.type === "CLEAR_BOOKMARKS_BY_URLS") {
      clearBookmarksByUrls(message.options || {})
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => sendResponse({ success: false, error: error.message || "삭제 실패" }));
      return true;
    }

    return false;
  });

  async function hydrateHudFromActiveRun() {
    try {
      const state = await chrome.storage.local.get({ [ACTIVE_RUN_STORAGE_KEY]: null });
      const activeRun = state[ACTIVE_RUN_STORAGE_KEY];
      if (activeRun?.isRunning && isBookmarksPage()) {
        renderHud(activeRun);
      }
    } catch (_error) {
      // Ignore storage hydration errors.
    }
  }

  function handleDocumentClick(event) {
    const bookmarkButton = findClosestTestId(event.target, ["bookmark", "removeBookmark"]);
    if (!bookmarkButton) {
      return;
    }

    const testId = bookmarkButton.getAttribute("data-testid");
    if (testId !== "bookmark") {
      return;
    }

    const article = bookmarkButton.closest('article[data-testid="tweet"]');
    if (!article) {
      return;
    }

    window.setTimeout(() => maybeCaptureBookmark(article), CONFIRM_DELAY_MS);
  }

  async function maybeCaptureBookmark(article) {
    const activeBookmarkButton = article.querySelector('[data-testid="removeBookmark"]');
    if (!activeBookmarkButton) {
      return;
    }

    const payload = extractTweetPayload(article);
    if (!payload?.url) {
      showToast("게시글 링크를 식별하지 못했습니다. 건너뜁니다.", "error");
      return;
    }

    try {
      const result = await savePayload(payload, { showStartToast: true });
      if (result?.deduped) {
        showToast("이 게시글은 이미 Obsidian에 있습니다.", "success");
      } else if (result?.fallbackUsed) {
        showToast("자리표시자 노트가 저장되었습니다. 나중에 수동으로 보완할 수 있습니다.", "success");
      } else {
        showToast("Obsidian에 저장되었습니다.", "success");
      }
    } catch (error) {
      showToast("저장 실패: " + normalizeErrorMessage(error), "error");
    }
  }

  async function syncBookmarkTimeline(options) {
    if (syncInFlight) {
      throw new Error("북마크 페이지 동기화가 이미 진행 중입니다");
    }
    if (!isBookmarksPage()) {
      throw new Error("먼저 X 북마크 페이지(/i/bookmarks)를 연 다음 동기화를 실행하세요.");
    }

    syncInFlight = true;
    hudDismissed = false;

    const targetItems = clampNumber(options.targetItems, 1, SYNC_MAX_ITEMS, 80);
    const estimatedMaxRounds = clampNumber(
      options.estimatedMaxRounds,
      8,
      SYNC_MAX_ROUNDS,
      estimateMaxRounds(targetItems)
    );
    const stats = {
      phase: "sync",
      targetItems,
      estimatedMaxRounds,
      rounds: 0,
      scanned: 0,
      attempted: 0,
      saved: 0,
      deduped: 0,
      fallback: 0,
      failed: 0,
      lastError: "",
      errorCounts: {},
      errorSamples: [],
      stoppedReason: "",
      clearCandidates: [],
      topErrors: [],
    };
    const seenUrls = new Set();
    let idleRounds = 0;

    showToast(`북마크 페이지 동기화를 시작합니다. 목표 ${targetItems}개...`, "info");
    await publishActiveRunStatus(buildSyncActiveStatus(stats, "starting"));
    await resetTimelineToTop();

    try {
      for (let round = 0; round < estimatedMaxRounds; round += 1) {
        stats.rounds = round + 1;
        const payloads = collectVisibleBookmarks(seenUrls, targetItems - stats.attempted);
        stats.scanned = seenUrls.size;

        if (payloads.length > 0) {
          idleRounds = 0;
          for (const payload of payloads) {
            stats.attempted += 1;
            try {
              const result = await savePayload(payload, { showStartToast: false });
      if (result?.deduped) {
        stats.deduped += 1;
        stats.clearCandidates.push(buildClearCandidate(payload));
      } else {
        stats.saved += 1;
        if (result?.fallbackUsed) {
          stats.fallback += 1;
        } else {
          stats.clearCandidates.push(buildClearCandidate(payload));
        }
      }
            } catch (error) {
              recordSyncError(stats, payload, error);
            }

            await publishActiveRunStatus(buildSyncActiveStatus(stats, "running"));

            if (stats.attempted >= targetItems) {
              break;
            }
          }
        } else {
          idleRounds += 1;
          await publishActiveRunStatus(buildSyncActiveStatus(stats, "running"));
        }

        if (stats.attempted >= targetItems) {
          stats.stoppedReason = "target_reached";
          break;
        }
        if (idleRounds >= SYNC_IDLE_ROUNDS) {
          stats.stoppedReason = "idle_limit";
          break;
        }

        const advanced = await scrollForMore();
        if (!advanced) {
          idleRounds += 1;
        }
      }
    } finally {
      syncInFlight = false;
    }

    if (!stats.stoppedReason) {
      stats.stoppedReason = "round_limit";
    }
    stats.clearCandidates = dedupeClearCandidates(stats.clearCandidates);
    stats.topErrors = buildTopErrors(stats.errorCounts);

    const completedStatus = buildSyncActiveStatus(stats, "completed");
    renderHud(completedStatus);
    await clearActiveRunStatus();
    showToast(buildSyncCompletionText(stats), stats.failed > 0 ? "error" : "success");
    return {
      ...stats,
      targetItems,
      estimatedMaxRounds,
      summaryText: buildSyncCompletionText(stats),
    };
  }

  async function clearBookmarksByUrls(options) {
    if (syncInFlight) {
      throw new Error("북마크 페이지 동기화가 진행 중입니다. 나중에 북마크를 삭제하세요.");
    }
    if (clearInFlight) {
      throw new Error("북마크 삭제가 이미 진행 중입니다");
    }
    if (!isBookmarksPage()) {
      throw new Error("먼저 X 북마크 페이지(/i/bookmarks)로 돌아간 다음 삭제를 실행하세요.");
    }

    const requestedItems = normalizeClearCandidates(options.items || options.urls || []);
    if (requestedItems.length === 0) {
      throw new Error("삭제할 북마크가 없습니다");
    }

    clearInFlight = true;
    hudDismissed = false;

    const remaining = new Map();
    for (const item of requestedItems) {
      remaining.set(getClearCandidateKey(item), item);
    }
    const failedByKey = new Map();
    const stats = {
      phase: "clear",
      requested: requestedItems.length,
      cleared: 0,
      failed: 0,
      rounds: 0,
      remainingItems: [],
      remainingUrls: [],
      lastError: "",
      errorCounts: {},
      errorSamples: [],
      topErrors: [],
      stoppedReason: "",
    };
    const maxRounds = clampNumber(options.maxRounds, 8, SYNC_MAX_ROUNDS, estimateClearRounds(remaining.size));
    let idleRounds = 0;

    showToast(`이번 회차 성공 북마크 ${remaining.size}개 삭제를 준비합니다...`, "info");
    await publishActiveRunStatus(buildClearActiveStatus(stats, remaining.size, "starting"));
    await resetTimelineToTop();

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        stats.rounds = round + 1;
        const progress = await clearVisibleBookmarks(remaining, failedByKey, stats);
        await publishActiveRunStatus(buildClearActiveStatus(stats, remaining.size, "running"));

        if (remaining.size === 0) {
          stats.stoppedReason = "completed";
          break;
        }

        const advanced = await scrollForMore();
        if (progress > 0 || advanced) {
          idleRounds = 0;
        } else {
          idleRounds += 1;
        }

        if (idleRounds >= SYNC_IDLE_ROUNDS) {
          stats.stoppedReason = "idle_limit";
          break;
        }
      }
    } finally {
      clearInFlight = false;
    }

    if (!stats.stoppedReason) {
      stats.stoppedReason = "round_limit";
    }

    finalizeClearFailures(remaining, failedByKey, stats);
    const completedStatus = buildClearActiveStatus(stats, remaining.size, "completed");
    renderHud(completedStatus);
    await clearActiveRunStatus();
    showToast(buildClearCompletionText(stats), stats.failed > 0 ? "error" : "success");

    return {
      ...stats,
      summaryText: buildClearCompletionText(stats),
    };
  }

  async function clearVisibleBookmarks(remaining, failedByKey, stats) {
    let progress = 0;
    let passProgress = 0;

    do {
      passProgress = 0;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');

      for (const article of articles) {
        const payload = extractTweetPayload(article);
        const candidate = buildClearCandidate(payload);
        const key = getClearCandidateKey(candidate);
        if (!key || !remaining.has(key)) {
          continue;
        }

        const item = remaining.get(key);
        const cleared = await clearBookmarkOnArticle(article, item, failedByKey);
        if (cleared) {
          remaining.delete(key);
          failedByKey.delete(key);
          stats.cleared += 1;
          progress += 1;
          passProgress += 1;
        }
      }

      if (passProgress > 0) {
        await delay(250);
      }
    } while (passProgress > 0 && remaining.size > 0);

    return progress;
  }

  async function clearBookmarkOnArticle(article, item, failedByKey) {
    const key = getClearCandidateKey(item);
    for (let attempt = 0; attempt < CLEAR_RETRY_LIMIT; attempt += 1) {
      const removeButton = article.querySelector('[data-testid="removeBookmark"]');
      if (!removeButton) {
        failedByKey.set(key, "북마크됨 버튼을 찾을 수 없습니다");
        return false;
      }

      removeButton.click();
      await delay(450 + attempt * 200);

      if (!article.isConnected) {
        return true;
      }

      const stillBookmarked = article.querySelector('[data-testid="removeBookmark"]');
      if (!stillBookmarked) {
        return true;
      }
    }

    failedByKey.set(key, "북마크 해제 후 버튼 상태가 업데이트되지 않았습니다");
    return false;
  }

  function finalizeClearFailures(remaining, failedByKey, stats) {
    for (const [key] of remaining) {
      if (!failedByKey.has(key)) {
        failedByKey.set(key, "현재 북마크 페이지에서 해당 항목을 다시 찾을 수 없습니다");
      }
    }

    stats.remainingItems = Array.from(remaining.values());
    stats.remainingUrls = stats.remainingItems.map((item) => item.url).filter(Boolean);
    stats.failed = stats.remainingUrls.length;
    stats.errorCounts = countFailureMessages(failedByKey);
    stats.topErrors = buildTopErrors(stats.errorCounts);
    stats.errorSamples = Array.from(failedByKey.entries())
      .slice(0, SYNC_ERROR_SAMPLE_LIMIT)
      .map(([key, error]) => ({
        key,
        url: remaining.get(key)?.url || "",
        tweet_id: remaining.get(key)?.tweetId || "",
        error,
      }));
    stats.lastError = stats.errorSamples[0]?.error || "";
  }

  function collectVisibleBookmarks(seenUrls, remaining) {
    if (remaining <= 0) {
      return [];
    }

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const payloads = [];

    for (const article of articles) {
      const payload = extractTweetPayload(article);
      if (!payload?.url || seenUrls.has(payload.url)) {
        continue;
      }
      seenUrls.add(payload.url);
      payloads.push(payload);
      if (payloads.length >= remaining) {
        break;
      }
    }

    return payloads;
  }

  async function scrollForMore() {
    const beforeHeight = document.documentElement.scrollHeight;
    const beforeCount = document.querySelectorAll('article[data-testid="tweet"]').length;
    window.scrollTo({ top: beforeHeight, behavior: "smooth" });
    await delay(SYNC_SCROLL_DELAY_MS);

    const afterHeight = document.documentElement.scrollHeight;
    const afterCount = document.querySelectorAll('article[data-testid="tweet"]').length;
    return afterHeight > beforeHeight || afterCount > beforeCount;
  }

  async function resetTimelineToTop() {
    window.scrollTo({ top: 0, behavior: "auto" });
    await delay(500);
  }

  async function savePayload(payload, options) {
    cleanupMap(PENDING_BY_URL, PENDING_TTL_MS);
    cleanupMap(RECENT_SUCCESS, RECENT_TTL_MS);

    if (PENDING_BY_URL.has(payload.url) || RECENT_SUCCESS.has(payload.url)) {
      return { deduped: true, skippedRecent: true };
    }

    PENDING_BY_URL.set(payload.url, Date.now());
    if (options.showStartToast) {
      showToast("Obsidian에 저장하는 중...", "info");
    }

    try {
      const response = await sendRuntimeMessage({ type: "SAVE_X_BOOKMARK", payload });
      if (!response?.success) {
        throw new Error(response?.error || "저장 실패");
      }
      RECENT_SUCCESS.set(payload.url, Date.now());
      return response.result || {};
    } finally {
      PENDING_BY_URL.delete(payload.url);
    }
  }

  function extractTweetPayload(article) {
    const statusLink = findStatusLink(article);
    const authorAnchor = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
    const authorHandle = extractHandle(authorAnchor?.getAttribute("href") || statusLink?.getAttribute("href") || "");
    const authorName = extractAuthorName(article);
    const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || "";
    const timeEl = article.querySelector("time");
    const metrics = extractMetrics(article);

    const url = normalizeStatusUrl(statusLink?.href || statusLink?.getAttribute("href") || "", authorHandle);
    const tweetIdMatch = url.match(/status\/(\d+)/);

    return {
      url,
      tweet_id: tweetIdMatch ? tweetIdMatch[1] : "",
      author_handle: authorHandle,
      author_name: authorName,
      text,
      published_at: timeEl?.getAttribute("datetime") || "",
      captured_at: new Date().toISOString(),
      source: "x-bookmark-click",
      metrics,
    };
  }

  function buildClearCandidate(payload) {
    const url = normalizeStatusUrl(payload?.url || "", payload?.author_handle || "");
    return {
      url,
      tweetId: String(payload?.tweet_id || extractTweetId(url) || ""),
    };
  }

  function extractAuthorName(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName) {
      return "";
    }
    const lines = userName.innerText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("@")) {
        return line;
      }
    }
    return lines[0] || "";
  }

  function extractMetrics(article) {
    const metrics = {
      replies: "0",
      reposts: "0",
      likes: "0",
      views: "0",
    };
    const group = article.querySelector('[role="group"]');
    if (!group) {
      return metrics;
    }

    const map = {
      reply: "replies",
      retweet: "reposts",
      like: "likes",
    };

    Object.entries(map).forEach(([testId, key]) => {
      const el = group.querySelector(`[data-testid="${testId}"]`);
      const label = el?.getAttribute("aria-label") || "";
      const match = label.match(/([\d,.]+(?:[KMB만억조])?)/i);
      if (match) {
        metrics[key] = match[1];
      }
    });

    const analytics = article.querySelector('a[href*="/analytics"]');
    const viewLabel = analytics?.getAttribute("aria-label") || "";
    const match = viewLabel.match(/([\d,.]+(?:[KMB만억조])?)/i);
    if (match) {
      metrics.views = match[1];
    }

    return metrics;
  }

  function findStatusLink(article) {
    const candidates = article.querySelectorAll('a[href*="/status/"]');
    for (const candidate of candidates) {
      if (candidate.closest('[data-testid="quoteTweet"]')) {
        continue;
      }
      if (candidate.querySelector("time")) {
        return candidate;
      }
    }
    return candidates[0] || null;
  }

  function normalizeStatusUrl(href, fallbackHandle = "") {
    if (!href) {
      return "";
    }
    const raw = href.startsWith("http") ? href : "https://x.com" + href;
    try {
      const url = new URL(raw);
      const statusIdMatch = url.pathname.match(/\/status\/(\d+)/);
      if (statusIdMatch && url.pathname.startsWith("/i/web/status/")) {
        if (fallbackHandle) {
          return `https://x.com/${fallbackHandle}/status/${statusIdMatch[1]}`;
        }
        return `https://x.com/i/web/status/${statusIdMatch[1]}`;
      }
      const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!match) {
        return raw;
      }
      return `https://x.com/${match[1]}/status/${match[2]}`;
    } catch (_error) {
      return raw;
    }
  }

  function extractTweetId(href) {
    const match = String(href || "").match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function extractHandle(href) {
    const match = href.match(/^\/([^/]+)(?:\/|$)/);
    return match ? match[1].replace(/^@/, "") : "";
  }

  function findClosestTestId(element, testIds) {
    let current = element;
    while (current && current !== document.body) {
      const testId = current.getAttribute?.("data-testid");
      if (testId && testIds.includes(testId)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function cleanupMap(map, ttlMs) {
    const now = Date.now();
    for (const [key, value] of map.entries()) {
      if (now - value > ttlMs) {
        map.delete(key);
      }
    }
  }

  function isBookmarksPage() {
    const path = window.location.pathname || "";
    return path === "/i/bookmarks" || path.startsWith("/i/bookmarks/");
  }

  function buildSyncCompletionText(stats) {
    const parts = [
      `목표 ${stats.targetItems}개`,
      `실제 처리 ${stats.attempted}개`,
      `신규 ${stats.saved}`,
      `중복 제거 ${stats.deduped}`,
    ];
    if (stats.fallback > 0) {
      parts.push(`폴백 ${stats.fallback}`);
    }
    if (stats.failed > 0) {
      parts.push(`실패 ${stats.failed}`);
    }
    parts.push(`사유: ${describeStopReason(stats.stoppedReason, "sync")}`);
    return parts.join(", ");
  }

  function buildClearCompletionText(stats) {
    const parts = [
      `${stats.cleared}개 삭제됨`,
      `${stats.remainingUrls.length}개 남음`,
      `사유: ${describeStopReason(stats.stoppedReason, "clear")}`,
    ];
    if (stats.failed > 0 && stats.topErrors?.length) {
      parts.push(`주요 원인 ${stats.topErrors[0].message}`);
    }
    return parts.join(", ");
  }

  function recordSyncError(stats, payload, error) {
    const message = normalizeErrorMessage(error);
    stats.failed += 1;
    stats.lastError = message;
    stats.errorCounts[message] = (stats.errorCounts[message] || 0) + 1;

    if (stats.errorSamples.length < SYNC_ERROR_SAMPLE_LIMIT) {
      stats.errorSamples.push({
        url: payload?.url || "",
        tweet_id: payload?.tweet_id || "",
        error: message,
      });
    }
  }

  function buildTopErrors(errorCounts) {
    return Object.entries(errorCounts || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([message, count]) => ({ message, count }));
  }

  function countFailureMessages(failedByUrl) {
    const counts = {};
    for (const message of failedByUrl.values()) {
      counts[message] = (counts[message] || 0) + 1;
    }
    return counts;
  }

  function normalizeErrorMessage(error) {
    const raw = String(error?.message || error || "").trim();
    if (!raw) {
      return "알 수 없는 오류";
    }
    return raw.length > 120 ? raw.slice(0, 117) + "..." : raw;
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(parsed)));
  }

  function estimateMaxRounds(targetItems) {
    return clampNumber(Math.ceil(targetItems / 5) + 2, 8, SYNC_MAX_ROUNDS, 18);
  }

  function estimateClearRounds(requested) {
    return clampNumber(Math.ceil(requested / 4) + 6, 8, SYNC_MAX_ROUNDS, 12);
  }

  function dedupeUrls(urls) {
    const seen = new Set();
    const result = [];
    for (const item of urls || []) {
      const normalized = normalizeStatusUrl(String(item || ""));
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }

  function normalizeClearCandidates(items) {
    const normalized = [];
    for (const raw of items || []) {
      if (!raw) {
        continue;
      }
      if (typeof raw === "string") {
        const url = normalizeStatusUrl(raw);
        if (!url) {
          continue;
        }
        normalized.push({
          url,
          tweetId: extractTweetId(url),
        });
        continue;
      }

      const url = normalizeStatusUrl(raw.url || "", raw.authorHandle || "");
      const tweetId = String(raw.tweetId || extractTweetId(url) || "");
      if (!url && !tweetId) {
        continue;
      }
      normalized.push({ url, tweetId });
    }
    return dedupeClearCandidates(normalized);
  }

  function getClearCandidateKey(item) {
    if (!item) {
      return "";
    }
    if (item.tweetId) {
      return `id:${item.tweetId}`;
    }
    const url = normalizeStatusUrl(item.url || "");
    return url ? `url:${url}` : "";
  }

  function dedupeClearCandidates(items) {
    const seen = new Set();
    const result = [];
    for (const item of normalizeClearCandidatesShallow(items)) {
      const key = getClearCandidateKey(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function normalizeClearCandidatesShallow(items) {
    const result = [];
    for (const raw of items || []) {
      if (!raw) {
        continue;
      }
      if (typeof raw === "string") {
        const url = normalizeStatusUrl(raw);
        if (!url) {
          continue;
        }
        result.push({ url, tweetId: extractTweetId(url) });
        continue;
      }
      const url = normalizeStatusUrl(raw.url || "", raw.authorHandle || "");
      const tweetId = String(raw.tweetId || extractTweetId(url) || "");
      if (!url && !tweetId) {
        continue;
      }
      result.push({ url, tweetId });
    }
    return result;
  }

  function describeStopReason(reason, phase) {
    if (phase === "clear") {
      if (reason === "completed") {
        return "모든 대상 북마크가 삭제되었습니다";
      }
      if (reason === "idle_limit") {
        return "여러 회차 동안 더 이상 삭제할 북마크를 찾지 못했습니다";
      }
      if (reason === "round_limit") {
        return "내부 스크롤 상한에 도달했습니다. 아직 재배치되지 않은 북마크가 있을 수 있습니다";
      }
      return "중지됨";
    }

    if (reason === "target_reached") {
      return "목표 동기화 개수에 도달했습니다";
    }
    if (reason === "idle_limit") {
      return "더 이상 북마크가 로드되지 않았습니다";
    }
    if (reason === "round_limit") {
      return "내부 스크롤 상한에 도달했습니다. 아직 로드되지 않은 북마크가 있을 수 있습니다";
    }
    return "중지됨";
  }

  function buildSyncActiveStatus(stats, stage) {
    return {
      phase: "sync",
      stage,
      isRunning: stage !== "completed",
      timestamp: Date.now(),
      targetItems: stats.targetItems,
      estimatedMaxRounds: stats.estimatedMaxRounds,
      attempted: stats.attempted,
      saved: stats.saved,
      deduped: stats.deduped,
      fallback: stats.fallback,
      failed: stats.failed,
      rounds: stats.rounds,
      latestError: stats.lastError,
      stoppedReason: stats.stoppedReason,
      statusLine:
        stage === "completed"
          ? buildSyncCompletionText(stats)
          : `동기화 중: ${stats.attempted}/${stats.targetItems}, 신규 ${stats.saved}, 중복 제거 ${stats.deduped}, 실패 ${stats.failed}`,
    };
  }

  function buildClearActiveStatus(stats, remainingCount, stage) {
    return {
      phase: "clear",
      stage,
      isRunning: stage !== "completed",
      timestamp: Date.now(),
      requested: stats.requested,
      cleared: stats.cleared,
      remainingCount,
      failed: stats.failed,
      rounds: stats.rounds,
      latestError: stats.lastError,
      stoppedReason: stats.stoppedReason,
      statusLine:
        stage === "completed"
          ? buildClearCompletionText(stats)
          : `삭제 중: ${stats.cleared}/${stats.requested}개 삭제됨, ${remainingCount}개 남음, 실패 ${stats.failed}`,
    };
  }

  async function publishActiveRunStatus(status) {
    renderHud(status);
    try {
      await chrome.storage.local.set({ [ACTIVE_RUN_STORAGE_KEY]: status });
    } catch (_error) {
      // Ignore storage update failures.
    }
  }

  async function clearActiveRunStatus() {
    try {
      await chrome.storage.local.set({ [ACTIVE_RUN_STORAGE_KEY]: null });
    } catch (_error) {
      // Ignore storage cleanup failures.
    }
  }

  function getHudRoot() {
    let root = document.getElementById(HUD_ID);
    if (root) {
      return root;
    }

    root = document.createElement("section");
    root.id = HUD_ID;
    root.innerHTML = [
      '<div class="x-bto-hud__header">',
      '  <div>',
      '    <p class="x-bto-hud__eyebrow">X Bookmark to Obsidian</p>',
      '    <h2 class="x-bto-hud__title">실행 상태</h2>',
      "  </div>",
      '  <button type="button" class="x-bto-hud__close" aria-label="닫기">×</button>',
      "</div>",
      '<p class="x-bto-hud__line" data-role="stage"></p>',
      '<p class="x-bto-hud__line" data-role="progress"></p>',
      '<p class="x-bto-hud__line" data-role="stats"></p>',
      '<p class="x-bto-hud__line" data-role="reason"></p>',
      '<p class="x-bto-hud__line x-bto-hud__line--muted" data-role="error"></p>',
    ].join("");

    root.querySelector(".x-bto-hud__close")?.addEventListener("click", () => {
      hudDismissed = true;
      root.remove();
    });

    document.documentElement.appendChild(root);
    return root;
  }

  function renderHud(status) {
    if (hudDismissed || !isBookmarksPage()) {
      return;
    }

    const root = getHudRoot();
    root.classList.toggle("is-running", !!status?.isRunning);
    root.classList.toggle("is-completed", !status?.isRunning);

    const stageEl = root.querySelector('[data-role="stage"]');
    const progressEl = root.querySelector('[data-role="progress"]');
    const statsEl = root.querySelector('[data-role="stats"]');
    const reasonEl = root.querySelector('[data-role="reason"]');
    const errorEl = root.querySelector('[data-role="error"]');

    if (!status) {
      stageEl.textContent = "실행 상태 없음";
      progressEl.textContent = "";
      statsEl.textContent = "";
      reasonEl.textContent = "";
      errorEl.textContent = "";
      return;
    }

    const phaseLabel = status.phase === "clear" ? "삭제 중" : "동기화 중";
    const completedLabel = status.phase === "clear" ? "삭제 완료" : "동기화 완료";
    stageEl.textContent = status.isRunning ? phaseLabel : completedLabel;

    if (status.phase === "clear") {
      progressEl.textContent = status.isRunning
        ? `${status.cleared}/${status.requested}개 삭제됨, ${status.remainingCount}개 남음`
        : `${status.cleared}/${status.requested}개 삭제됨, ${status.remainingCount || 0}개 남음`;
      statsEl.textContent = `실패 ${status.failed} · ${status.rounds}회차`;
      reasonEl.textContent = status.isRunning
        ? status.statusLine
        : `중지 사유: ${describeStopReason(status.stoppedReason, "clear")}`;
    } else {
      progressEl.textContent = status.isRunning
        ? `${status.attempted}/${status.targetItems}개 처리됨`
        : `목표 ${status.targetItems}개, 실제 처리 ${status.attempted}개`;
      statsEl.textContent = `신규 ${status.saved} · 중복 제거 ${status.deduped} · 폴백 ${status.fallback} · 실패 ${status.failed}`;
      reasonEl.textContent = status.isRunning
        ? status.statusLine
        : `중지 사유: ${describeStopReason(status.stoppedReason, "sync")}`;
    }

    errorEl.textContent = status.latestError ? `최근 오류: ${status.latestError}` : "";
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("확장 프로그램 백그라운드 연결에 실패했습니다. 페이지를 새로고침한 후 다시 시도하세요."));
          return;
        }
        resolve(response);
      });
    });
  }

  function getToastRoot() {
    let root = document.getElementById(TOAST_ID);
    if (root) {
      return root;
    }
    root = document.createElement("div");
    root.id = TOAST_ID;
    document.documentElement.appendChild(root);
    return root;
  }

  function showToast(message, type) {
    const root = getToastRoot();
    const toast = document.createElement("div");
    toast.className = "x-bto-toast x-bto-" + type;
    toast.textContent = message;
    root.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("is-visible"));

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 2200);
  }
})();
