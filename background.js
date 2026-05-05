const NATIVE_HOST_NAME = "com.btl.file_writer";
const DEFAULT_OUTPUT_DIR = "";
const DEFAULT_TARGET_SYNC_COUNT = 80;
const DEFAULT_SYNC_MAX_ROUNDS = 18;
const INSTALL_HINT = "로컬 설치가 완료되지 않았습니다. install.command를 먼저 실행한 후 다시 시도하세요.";
const ACTIVE_RUN_STORAGE_KEY = "activeRunStatus";

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
});

async function handleSaveBookmark(payload) {
  const safePayload = sanitizePayload(payload);
  validatePayload(safePayload);
  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
  });
  safePayload.output_dir = (syncState.obsidianOutputDir || DEFAULT_OUTPUT_DIR).trim();

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
    throw new Error(result?.error || INSTALL_HINT);
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

  return {
    url: String(payload?.url || ""),
    tweet_id: String(payload?.tweet_id || ""),
    author_handle: authorHandle,
    author_name: authorName,
    text,
    published_at: String(payload?.published_at || ""),
    captured_at: String(payload?.captured_at || ""),
    source: "x-bookmark-click",
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
