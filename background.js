const NATIVE_HOST_NAME = "com.btl.file_writer";
const DEFAULT_OUTPUT_DIR = "";
const DEFAULT_FILENAME_TEMPLATE = "{title}";
const DEFAULT_TARGET_SYNC_COUNT = 80;
const DEFAULT_SYNC_MAX_ROUNDS = 18;
const INSTALL_HINT = "로컬 설치가 완료되지 않았습니다. install.command를 먼저 실행한 후 다시 시도하세요.";
const ACTIVE_RUN_STORAGE_KEY = "activeRunStatus";
const RETRY_QUEUE_KEY = "retryQueue";
const MAX_RETRY_COUNT = 4;
const RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000];
const RETRY_ALARM_NAME = "retryQueueAlarm";

chrome.runtime.onInstalled.addListener(async () => {
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    targetSyncCount: DEFAULT_TARGET_SYNC_COUNT,
  });
  await chrome.storage.local.set({
    extensionMode: "x-bookmark-to-obsidian",
    lastResult: null,
    lastSyncResult: null,
    [ACTIVE_RUN_STORAGE_KEY]: null,
  });
  await chrome.storage.sync.set({
    obsidianOutputDir: syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR,
    targetSyncCount: sanitizeNumber(syncState.targetSyncCount, 1, 200, DEFAULT_TARGET_SYNC_COUNT),
  });
  restoreRetryQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM_NAME) {
    processRetryQueue();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SAVE_X_BOOKMARK") {
    handleSaveBookmark(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => {
        const failure = {
          ok: false,
          error: error.message || "알 수 없는 오류",
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ lastResult: failure });
        sendResponse({ success: false, error: failure.error, result: failure });
      });
    return true;
  }

  if (message?.type === "START_BOOKMARK_PAGE_SYNC") {
    startBookmarkPageSync(message.options || {})
      .then((result) => sendResponse({ success: true, result }))
      .catch(async (error) => {
        const failure = {
          ok: false,
          timestamp: Date.now(),
          error: error.message || "동기화 실패",
        };
        await chrome.storage.local.set({
          lastSyncResult: failure,
          [ACTIVE_RUN_STORAGE_KEY]: null,
        });
        sendResponse({ success: false, error: failure.error, result: failure });
      });
    return true;
  }

  if (message?.type === "CLEAR_LAST_SYNC_BOOKMARKS") {
    clearLastSyncedBookmarks()
      .then((result) => sendResponse({ success: true, result }))
      .catch(async (error) => {
        const failure = {
          ok: false,
          timestamp: Date.now(),
          error: error.message || "삭제 실패",
        };
        const state = await chrome.storage.local.get({ lastSyncResult: null });
        if (state.lastSyncResult) {
          await chrome.storage.local.set({
            lastSyncResult: {
              ...state.lastSyncResult,
              clearResult: failure,
            },
            [ACTIVE_RUN_STORAGE_KEY]: null,
          });
        }
        sendResponse({ success: false, error: failure.error, result: failure });
      });
    return true;
  }

  if (message?.type === "PING_NATIVE_HOST") {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: "ping" })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: mapNativeHostError(error) }));
    return true;
  }

  if (message?.type === "GET_STATUS") {
    chrome.storage.local.get({
      lastResult: null,
      lastSyncResult: null,
      [ACTIVE_RUN_STORAGE_KEY]: null,
      extensionMode: "x-bookmark-to-obsidian",
    }).then(async (state) => {
      const syncState = await chrome.storage.sync.get({
        obsidianOutputDir: DEFAULT_OUTPUT_DIR,
        targetSyncCount: DEFAULT_TARGET_SYNC_COUNT,
      });
      sendResponse({
        success: true,
        state: {
          ...state,
          obsidianOutputDir: syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR,
          targetSyncCount: sanitizeNumber(syncState.targetSyncCount, 1, 200, DEFAULT_TARGET_SYNC_COUNT),
        },
      });
    });
    return true;
  }

  if (message?.type === "PICK_OUTPUT_DIR") {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: "pick_folder" })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: mapNativeHostError(error) }));
    return true;
  }

  if (message?.type === "RETRY_FAILED_ITEMS") {
    processRetryQueue()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARCHIVE_X_BOOKMARK") {
    handleArchiveBookmark(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message || "보관 처리 실패" }));
    return true;
  }

  if (message?.type === "GET_RETRY_QUEUE") {
    chrome.storage.local.get({ [RETRY_QUEUE_KEY]: [] }).then((state) => {
      sendResponse({ success: true, items: state[RETRY_QUEUE_KEY] || [] });
    });
    return true;
  }

  if (message?.type === "SAVE_THREADS_BOOKMARK") {
    handleSaveThreadsBookmark(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => {
        const failure = {
          ok: false,
          error: error.message || "알 수 없는 오류",
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ lastResult: failure });
        sendResponse({ success: false, error: failure.error, result: failure });
      });
    return true;
  }
});

async function handleSaveBookmark(payload) {
  const safePayload = sanitizePayload(payload);
  validatePayload(safePayload);
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    downloadMedia: false,
    defaultTags: "",
  });
  safePayload.output_dir = (syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR).trim();
  safePayload.filename_template = (syncState.filenameTemplate || DEFAULT_FILENAME_TEMPLATE).trim();
  safePayload.download_media = !!syncState.downloadMedia;
  safePayload.default_tags = (syncState.defaultTags || "").trim();

  if (!safePayload.output_dir) {
    throw new Error("먼저 플러그인 팝업에서 Obsidian 저장 경로를 설정하세요.");
  }

  let result;
  try {
    result = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: "save_x_bookmark",
      payload: safePayload,
    });
  } catch (error) {
    throw new Error(mapNativeHostError(error));
  }

  if (!result?.success) {
    const errorMsg = result?.error || INSTALL_HINT;
    if (!isPermissionError(errorMsg)) {
      await enqueueRetryItem(safePayload);
    }
    throw new Error(errorMsg);
  }

  const persisted = {
    ok: true,
    timestamp: Date.now(),
    url: safePayload.url,
    path: result.path,
    deduped: !!result.deduped,
    fallbackUsed: !!result.fallback_used,
    fetchStatus: result.fetch_status || "unknown",
    noteTitle: result.note_title || "",
  };
  await chrome.storage.local.set({ lastResult: persisted });
  return persisted;
}

async function handleArchiveBookmark(payload) {
  const safePayload = sanitizePayload(payload);
  validatePayload(safePayload);
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    downloadMedia: false,
    defaultTags: "",
  });
  safePayload.output_dir = (syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR).trim();
  safePayload.filename_template = (syncState.filenameTemplate || DEFAULT_FILENAME_TEMPLATE).trim();
  safePayload.download_media = !!syncState.downloadMedia;
  safePayload.default_tags = (syncState.defaultTags || "").trim();

  if (!safePayload.output_dir) {
    throw new Error("먼저 플러그인 팝업에서 Obsidian 저장 경로를 설정하세요.");
  }

  let result;
  try {
    result = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: "archive_x_bookmark",
      payload: safePayload,
    });
  } catch (error) {
    throw new Error(mapNativeHostError(error));
  }

  if (!result?.success) {
    throw new Error(result?.error || INSTALL_HINT);
  }

  return result;
}

async function handleSaveThreadsBookmark(payload) {
  const safePayload = sanitizePayload(payload);
  validateThreadsPayload(safePayload);
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    downloadMedia: false,
    defaultTags: "",
  });
  safePayload.output_dir = (syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR).trim();
  safePayload.filename_template = (syncState.filenameTemplate || DEFAULT_FILENAME_TEMPLATE).trim();
  safePayload.download_media = !!syncState.downloadMedia;
  safePayload.default_tags = (syncState.defaultTags || "").trim();
  if (!safePayload.output_dir) {
    throw new Error("먼저 플러그인 팝업에서 Obsidian 저장 경로를 설정하세요.");
  }

  let result;
  try {
    result = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: "save_threads_bookmark",
      payload: safePayload,
    });
  } catch (error) {
    throw new Error(mapNativeHostError(error));
  }

  if (!result?.success) {
    const errorMsg = result?.error || INSTALL_HINT;
    if (!isPermissionError(errorMsg)) {
      await enqueueRetryItem(safePayload);
    }
    throw new Error(errorMsg);
  }

  const persisted = {
    ok: true,
    timestamp: Date.now(),
    url: safePayload.url,
    path: result.path,
    deduped: !!result.deduped,
    fallbackUsed: !!result.fallback_used,
    fetchStatus: result.fetch_status || "unknown",
    noteTitle: result.note_title || "",
  };
  await chrome.storage.local.set({ lastResult: persisted });
  return persisted;
}

function validateThreadsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("페이로드 누락");
  }
  if (typeof payload.url !== "string" || !/^https:\/\/www\.threads\.(com|net)\/@[\w.]+\/post\/[A-Za-z0-9_-]+/.test(payload.url)) {
    throw new Error("유효하지 않은 Threads URL: " + payload.url);
  }
}

async function startBookmarkPageSync(options) {
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    targetSyncCount: DEFAULT_TARGET_SYNC_COUNT,
  });
  const outputDir = String(syncState.obsidianOutputDir || "").trim();
  if (!outputDir) {
    throw new Error("먼저 플러그인 팝업에서 Obsidian 저장 경로를 설정하세요.");
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    throw new Error("현재 탭을 찾을 수 없습니다");
  }

  const url = String(tab.url || "");
  if (!/^https:\/\/(x|twitter)\.com\//.test(url)) {
    throw new Error("먼저 X 페이지로 이동한 후 동기화를 실행하세요.");
  }

  const targetItems = sanitizeNumber(
    options.targetItems,
    1,
    200,
    sanitizeNumber(syncState.targetSyncCount, 1, 200, DEFAULT_TARGET_SYNC_COUNT)
  );
  const estimatedMaxRounds = estimateMaxRounds(targetItems);

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "START_BOOKMARK_PAGE_SYNC",
      options: {
        targetItems,
        estimatedMaxRounds,
      },
    });
  } catch (error) {
    throw new Error(mapTabMessageError(error));
  }

  if (!response?.success) {
    const failedResult = {
      ok: false,
      timestamp: Date.now(),
      error: response?.error || "동기화 실패",
      targetItems,
      estimatedMaxRounds,
    };
    await chrome.storage.local.set({
      lastSyncResult: failedResult,
      [ACTIVE_RUN_STORAGE_KEY]: null,
    });
    throw new Error(failedResult.error);
  }

  const result = response.result || {};
  const clearableItems = normalizeClearItems(result.clearCandidates);
  const clearableUrls = clearableItems.map((item) => item.url).filter(Boolean);
  const persisted = {
    ok: true,
    timestamp: Date.now(),
    ...result,
    targetItems,
    estimatedMaxRounds,
    clearableItems,
    clearableUrls,
    pendingClearItems: clearableItems,
    pendingClearUrls: clearableUrls,
    clearResult: null,
  };
  await chrome.storage.local.set({
    lastSyncResult: persisted,
    [ACTIVE_RUN_STORAGE_KEY]: null,
  });
  return persisted;
}

async function clearLastSyncedBookmarks() {
  const state = await chrome.storage.local.get({ lastSyncResult: null });
  const lastSyncResult = state.lastSyncResult;
  if (!lastSyncResult?.ok) {
    throw new Error("삭제할 일괄 동기화 결과가 없습니다");
  }

  const pendingItems = normalizeClearItems(lastSyncResult.pendingClearItems || lastSyncResult.pendingClearUrls || []);
  if (pendingItems.length === 0) {
    throw new Error("이번 회차에 삭제 대기 중인 성공 북마크가 없습니다");
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    throw new Error("현재 탭을 찾을 수 없습니다");
  }

  const url = String(tab.url || "");
  if (!/^https:\/\/(x|twitter)\.com\//.test(url)) {
    throw new Error("먼저 X 페이지로 이동한 후 삭제를 실행하세요.");
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, {
        type: "CLEAR_BOOKMARKS_BY_URLS",
        options: {
        items: pendingItems,
        maxRounds: estimateClearRounds(pendingItems.length),
      },
    });
  } catch (error) {
    throw new Error(mapTabMessageError(error));
  }

  if (!response?.success) {
    throw new Error(response?.error || "삭제 실패");
  }

  const clearResult = {
    ok: true,
    timestamp: Date.now(),
    ...response.result,
  };
  const remainingItems = normalizeClearItems(clearResult.remainingItems || clearResult.remainingUrls || []);
  const nextState = {
    ...lastSyncResult,
    pendingClearItems: remainingItems,
    pendingClearUrls: remainingItems.map((item) => item.url).filter(Boolean),
    clearResult,
  };
  await chrome.storage.local.set({
    lastSyncResult: nextState,
    [ACTIVE_RUN_STORAGE_KEY]: null,
  });
  return nextState;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("페이로드 누락");
  }
  if (typeof payload.url !== "string" || !/^https:\/\/(x|twitter)\.com\/.+\/status\/\d+/.test(payload.url)) {
    throw new Error("유효하지 않은 트윗 URL");
  }
}

function sanitizePayload(payload) {
  const text = typeof payload?.text === "string" ? payload.text.slice(0, 4000) : "";
  const authorName = typeof payload?.author_name === "string" ? payload.author_name.slice(0, 200) : "";
  const authorHandle = typeof payload?.author_handle === "string" ? payload.author_handle.slice(0, 100) : "";
  const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : {};

  const mediaUrls = Array.isArray(payload?.media_urls) ? payload.media_urls.filter(u => typeof u === "string") : [];
  const externalLinks = Array.isArray(payload?.external_links) ? payload.external_links.filter(u => typeof u === "string") : [];

  const source = typeof payload?.source === "string" ? payload.source : "x-bookmark-click";
  const platform = typeof payload?.platform === "string" ? payload.platform : "x";

  return {
    url: String(payload?.url || ""),
    tweet_id: String(payload?.tweet_id || ""),
    author_handle: authorHandle,
    author_name: authorName,
    text,
    published_at: String(payload?.published_at || ""),
    captured_at: String(payload?.captured_at || ""),
    source,
    platform,
    content_hash: String(payload?.content_hash || ""),
    media_urls: mediaUrls,
    external_links: externalLinks,
    metrics: {
      likes: String(metrics.likes || ""),
      reposts: String(metrics.reposts || ""),
      views: String(metrics.views || ""),
      replies: String(metrics.replies || ""),
    },
  };
}

function normalizeClearItems(items) {
  const seen = new Set();
  const result = [];
  for (const raw of items || []) {
    if (!raw) {
      continue;
    }

    const item = typeof raw === "string"
      ? { url: normalizeStatusUrl(raw), tweetId: extractTweetId(raw) }
      : {
          url: normalizeStatusUrl(raw.url || ""),
          tweetId: String(raw.tweetId || extractTweetId(raw.url || "") || ""),
        };

    if (!item.url && !item.tweetId) {
      continue;
    }

    const key = item.tweetId ? `id:${item.tweetId}` : `url:${item.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeStatusUrl(href) {
  if (!href) {
    return "";
  }
  const raw = String(href);
  const absolute = raw.startsWith("http") ? raw : "https://x.com" + raw;
  try {
    const url = new URL(absolute);
    const statusId = extractTweetId(url.pathname);
    if (!statusId) {
      return absolute;
    }
    const handleMatch = url.pathname.match(/^\/([^/]+)\/status\/\d+/);
    if (handleMatch) {
      return `https://x.com/${handleMatch[1]}/status/${statusId}`;
    }
    return `https://x.com/i/web/status/${statusId}`;
  } catch (_error) {
    return absolute;
  }
}

function extractTweetId(value) {
  const match = String(value || "").match(/\/status\/(\d+)/);
  return match ? match[1] : "";
}

function mapNativeHostError(error) {
  const message = String(error?.message || error || "");
  if (
    message.includes("Specified native messaging host not found") ||
    message.includes("Native host has exited") ||
    message.includes("Access to the specified native messaging host is forbidden")
  ) {
    return INSTALL_HINT;
  }
  return message || INSTALL_HINT;
}

function mapTabMessageError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Receiving end does not exist")) {
    return "현재 페이지에 플러그인이 주입되지 않았습니다. X 페이지를 새로고침한 후 다시 시도하세요.";
  }
  return message || "현재 페이지에 연결할 수 없습니다";
}

function sanitizeNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function estimateMaxRounds(targetItems) {
  return sanitizeNumber(Math.ceil(targetItems / 5) + 2, 8, 40, DEFAULT_SYNC_MAX_ROUNDS);
}

function estimateClearRounds(pendingItems) {
  return sanitizeNumber(Math.ceil(pendingItems / 4) + 6, 8, 40, 12);
}

async function enqueueRetryItem(payload) {
  const state = await chrome.storage.local.get({ [RETRY_QUEUE_KEY]: [] });
  const queue = state[RETRY_QUEUE_KEY] || [];

  const alreadyQueued = queue.some(
    (item) => item.url === payload.url && item.status === "pending"
  );
  if (alreadyQueued) {
    return;
  }

  queue.push({
    queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    payload,
    action: "create",
    status: "pending",
    retryCount: 0,
    nextRetryAt: Date.now() + RETRY_BACKOFF_MS[0],
    lastError: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: queue });
  scheduleRetryAlarm();
}

async function processRetryQueue() {
  const state = await chrome.storage.local.get({ [RETRY_QUEUE_KEY]: [] });
  const queue = state[RETRY_QUEUE_KEY] || [];
  if (queue.length === 0) {
    return { processed: 0, remaining: 0 };
  }

  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    downloadMedia: false,
    defaultTags: "",
  });
  const outputDir = (syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR).trim();
  if (!outputDir) {
    return { processed: 0, remaining: queue.length, error: "저장 경로가 설정되지 않았습니다" };
  }

  const now = Date.now();
  let processed = 0;

  for (const item of queue) {
    if (item.status !== "pending") {
      continue;
    }
    if (item.nextRetryAt && now < item.nextRetryAt) {
      continue;
    }

    item.status = "processing";
    item.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: queue });

    try {
      const payload = {
        ...item.payload,
        output_dir: outputDir,
        filename_template: (syncState.filenameTemplate || DEFAULT_FILENAME_TEMPLATE).trim(),
        download_media: !!syncState.downloadMedia,
        default_tags: (syncState.defaultTags || "").trim(),
      };
      const isThreads = item.payload.platform === "threads"
        || (item.payload.source || "").includes("threads");
      const action = isThreads ? "save_threads_bookmark" : "save_x_bookmark";
      const result = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
        action,
        payload,
      });

      if (result?.success) {
        item.status = "completed";
        processed += 1;
      } else if (isPermissionError(result?.error || "")) {
        item.status = "failed";
        item.lastError = result?.error || INSTALL_HINT;
        item.updatedAt = new Date().toISOString();
      } else {
        item.retryCount += 1;
        if (item.retryCount >= MAX_RETRY_COUNT) {
          item.status = "failed";
          item.lastError = result?.error || INSTALL_HINT;
        } else {
          item.status = "pending";
          item.nextRetryAt = now + RETRY_BACKOFF_MS[Math.min(item.retryCount, RETRY_BACKOFF_MS.length - 1)];
          item.lastError = result?.error || INSTALL_HINT;
        }
        item.updatedAt = new Date().toISOString();
      }
    } catch (error) {
      const errorMsg = mapNativeHostError(error);
      item.retryCount += 1;
      if (item.retryCount >= MAX_RETRY_COUNT || isPermissionError(errorMsg)) {
        item.status = "failed";
      } else {
        item.status = "pending";
        item.nextRetryAt = now + RETRY_BACKOFF_MS[Math.min(item.retryCount, RETRY_BACKOFF_MS.length - 1)];
      }
      item.lastError = errorMsg;
      item.updatedAt = new Date().toISOString();
    }

    await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: queue });
  }

  const remaining = queue.filter((item) => item.status === "pending").length;
  if (remaining > 0) {
    scheduleRetryAlarm();
  }

  return { processed, remaining };
}

function scheduleRetryAlarm() {
  chrome.alarms.get(RETRY_ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(RETRY_ALARM_NAME, { delayInMinutes: 0.5 });
    }
  });
}

async function restoreRetryQueue() {
  const state = await chrome.storage.local.get({ [RETRY_QUEUE_KEY]: [] });
  const queue = state[RETRY_QUEUE_KEY] || [];
  const pending = queue.filter((item) => item.status === "pending");
  if (pending.length > 0) {
    scheduleRetryAlarm();
  }
}

function isPermissionError(errorMsg) {
  const msg = String(errorMsg || "").toLowerCase();
  return (
    msg.includes("permission") ||
    msg.includes("denied") ||
    msg.includes("not found") ||
    msg.includes("forbidden") ||
    msg.includes("권한") ||
    msg.includes("invalid directory")
  );
}
