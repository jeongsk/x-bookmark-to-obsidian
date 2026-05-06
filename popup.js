document.addEventListener("DOMContentLoaded", async () => {
  const DEFAULT_OUTPUT_DIR = "";
  const DEFAULT_TARGET_SYNC_COUNT = 80;
  const INSTALL_HINT = "Native Host가 연결되지 않았습니다. install.command를 먼저 실행하세요.";
  const POLL_INTERVAL_MS = 1200;

  const nativeStatusEl = document.getElementById("native-status");
  const lastResultEl = document.getElementById("last-result");
  const outputDirEl = document.getElementById("output-dir");
  const saveDirBtn = document.getElementById("save-dir");
  const pickDirBtn = document.getElementById("pick-dir");
  const saveDirStatusEl = document.getElementById("save-dir-status");
  const syncBookmarksBtn = document.getElementById("sync-bookmarks");
  const syncStatusEl = document.getElementById("sync-status");
  const syncLastResultEl = document.getElementById("sync-last-result");
  const targetSyncCountEl = document.getElementById("target-sync-count");
  const clearActionEl = document.getElementById("clear-action");
  const clearPromptEl = document.getElementById("clear-prompt");
  const clearBookmarksBtn = document.getElementById("clear-bookmarks");
  const clearStatusEl = document.getElementById("clear-status");
  const errorLogEmptyEl = document.getElementById("error-log-empty");
  const errorLogListEl = document.getElementById("error-log-list");
  const retryFailedBtn = document.getElementById("retry-failed");
  const filenameTemplateEl = document.getElementById("filename-template");
  const filenamePreviewEl = document.getElementById("filename-preview");
  const downloadMediaToggleEl = document.getElementById("download-media-toggle");
  const defaultTagsEl = document.getElementById("default-tags");
  const DEFAULT_FILENAME_TEMPLATE = "{title}";
  let targetSyncCountDirty = false;
  let filenameTemplateDirty = false;
  const clearActionRefs = {
    container: clearActionEl,
    prompt: clearPromptEl,
    button: clearBookmarksBtn,
    status: clearStatusEl,
  };

  const syncState = await chrome.storage.sync.get({
    obsidianOutputDir: DEFAULT_OUTPUT_DIR,
    targetSyncCount: DEFAULT_TARGET_SYNC_COUNT,
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    downloadMedia: false,
    defaultTags: "",
  });
  outputDirEl.value = syncState.obsidianOutputDir || "";
  targetSyncCountEl.value = sanitizeNumber(syncState.targetSyncCount, 1, 200, DEFAULT_TARGET_SYNC_COUNT);
  filenameTemplateEl.value = syncState.filenameTemplate || DEFAULT_FILENAME_TEMPLATE;
  downloadMediaToggleEl.checked = !!syncState.downloadMedia;
  defaultTagsEl.value = syncState.defaultTags || "";
  updateFilenamePreview();

  try {
    const nativeStatus = await sendMessage({ type: "PING_NATIVE_HOST" });
    nativeStatusEl.textContent = nativeStatus?.success ? "Native Host 연결됨" : INSTALL_HINT;
  } catch (_error) {
    nativeStatusEl.textContent = INSTALL_HINT;
  }

  await refreshStatus();
  const poller = window.setInterval(refreshStatus, POLL_INTERVAL_MS);
  window.addEventListener("beforeunload", () => window.clearInterval(poller), { once: true });

  targetSyncCountEl.addEventListener("input", () => {
    targetSyncCountDirty = true;
  });

  targetSyncCountEl.addEventListener("change", async () => {
    const targetSyncCount = sanitizeNumber(targetSyncCountEl.value, 1, 200, DEFAULT_TARGET_SYNC_COUNT);
    targetSyncCountEl.value = targetSyncCount;
    await chrome.storage.sync.set({ targetSyncCount });
    targetSyncCountDirty = false;
    saveDirStatusEl.textContent = "목표 동기화 개수가 업데이트되었습니다.";
  });

  filenameTemplateEl.addEventListener("input", () => {
    filenameTemplateDirty = true;
    updateFilenamePreview();
  });

  filenameTemplateEl.addEventListener("change", async () => {
    const template = filenameTemplateEl.value.trim() || DEFAULT_FILENAME_TEMPLATE;
    filenameTemplateEl.value = template;
    await chrome.storage.sync.set({ filenameTemplate: template });
    filenameTemplateDirty = false;
    updateFilenamePreview();
  });

  downloadMediaToggleEl.addEventListener("change", async () => {
    await chrome.storage.sync.set({ downloadMedia: downloadMediaToggleEl.checked });
  });

  defaultTagsEl.addEventListener("change", async () => {
    const tags = defaultTagsEl.value.trim();
    await chrome.storage.sync.set({ defaultTags: tags });
    saveDirStatusEl.textContent = "기본 태그가 업데이트되었습니다.";
  });

  saveDirBtn.addEventListener("click", async () => {
    const nextPath = outputDirEl.value.trim();
    if (!isValidAbsolutePath(nextPath)) {
      saveDirStatusEl.textContent = "절대 경로를 입력하거나 \"폴더 선택\"을 사용하세요.";
      return;
    }

    const targetSyncCount = sanitizeNumber(targetSyncCountEl.value, 1, 200, DEFAULT_TARGET_SYNC_COUNT);
    targetSyncCountEl.value = targetSyncCount;
    await chrome.storage.sync.set({
      obsidianOutputDir: nextPath,
      targetSyncCount,
    });
    targetSyncCountDirty = false;
    saveDirStatusEl.textContent = "저장 경로가 업데이트되었습니다.";
  });

  pickDirBtn.addEventListener("click", async () => {
    saveDirStatusEl.textContent = "폴더 선택기를 여는 중...";
    try {
      const result = await sendMessage({ type: "PICK_OUTPUT_DIR" });
      if (!result?.success || !result.path) {
        saveDirStatusEl.textContent = result?.error ? "선택 실패: " + result.error : "폴더가 선택되지 않았습니다.";
        return;
      }
      outputDirEl.value = result.path;
      await chrome.storage.sync.set({ obsidianOutputDir: result.path });
      saveDirStatusEl.textContent = "저장 경로가 업데이트되었습니다.";
    } catch (_error) {
      saveDirStatusEl.textContent = "폴더 선택기 열기 실패.";
    }
  });

  syncBookmarksBtn.addEventListener("click", async () => {
    const outputDir = outputDirEl.value.trim();
    if (!isValidAbsolutePath(outputDir)) {
      syncStatusEl.textContent = "유효한 Obsidian 절대 경로를 먼저 입력하세요.";
      return;
    }

    const targetSyncCount = sanitizeNumber(targetSyncCountEl.value, 1, 200, DEFAULT_TARGET_SYNC_COUNT);
    targetSyncCountEl.value = targetSyncCount;

    syncBookmarksBtn.disabled = true;
    syncStatusEl.textContent = `북마크 페이지 동기화를 요청 중입니다. 목표 ${targetSyncCount}개...`;

    try {
      await chrome.storage.sync.set({
        obsidianOutputDir: outputDir,
        targetSyncCount,
      });
      targetSyncCountDirty = false;

      const response = await sendMessage({
        type: "START_BOOKMARK_PAGE_SYNC",
        options: {
          targetItems: targetSyncCount,
        },
      });

      if (!response?.success) {
        syncStatusEl.textContent = "동기화 실패: " + (response?.error || "알 수 없는 오류");
        await refreshStatus();
        return;
      }

      syncStatusEl.textContent = formatSyncSummary(response.result || {});
      await refreshStatus();
    } catch (error) {
      syncStatusEl.textContent = "동기화 실패: " + (error?.message || "알 수 없는 오류");
    } finally {
      syncBookmarksBtn.disabled = false;
    }
  });

  clearBookmarksBtn.addEventListener("click", async () => {
    clearBookmarksBtn.disabled = true;
    clearStatusEl.textContent = "이번 회차 성공 북마크를 삭제하는 중...";

    try {
      const response = await sendMessage({ type: "CLEAR_LAST_SYNC_BOOKMARKS" });
      if (!response?.success) {
        clearStatusEl.textContent = "삭제 실패: " + (response?.error || "알 수 없는 오류");
        await refreshStatus();
        return;
      }

      await refreshStatus();
    } catch (error) {
      clearStatusEl.textContent = "삭제 실패: " + (error?.message || "알 수 없는 오류");
    } finally {
      clearBookmarksBtn.disabled = false;
    }
  });

  retryFailedBtn.addEventListener("click", async () => {
    retryFailedBtn.disabled = true;
    try {
      const response = await sendMessage({ type: "RETRY_FAILED_ITEMS" });
      if (response?.success) {
        saveDirStatusEl.textContent = `재시도 완료: ${response.result?.processed || 0}건 처리됨`;
      } else {
        saveDirStatusEl.textContent = "재시도 실패: " + (response?.error || "알 수 없는 오류");
      }
      await refreshStatus();
    } catch (error) {
      saveDirStatusEl.textContent = "재시도 실패: " + (error?.message || "알 수 없는 오류");
    } finally {
      retryFailedBtn.disabled = false;
    }
  });

  async function refreshStatus() {
    try {
      const status = await sendMessage({ type: "GET_STATUS" });
      const state = status?.state || {};
      const last = state.lastResult;
      const lastSync = state.lastSyncResult;
      const activeRun = state.activeRunStatus;

      if (!last) {
        lastResultEl.textContent = "최근 저장: 기록 없음";
      } else {
        const when = new Date(last.timestamp).toLocaleString("ko-KR", { hour12: false });
        if (last.ok) {
          const suffix = last.deduped ? "(중복 제거됨)" : "";
          lastResultEl.textContent = `최근 저장: ${when} ${suffix}`;
        } else {
          lastResultEl.textContent = `최근 저장 실패: ${when} ${last.error || ""}`;
        }
      }

      if (document.activeElement !== targetSyncCountEl && !targetSyncCountDirty) {
        targetSyncCountEl.value = sanitizeNumber(state.targetSyncCount, 1, 200, DEFAULT_TARGET_SYNC_COUNT);
      }
      renderSyncStatus(syncStatusEl, activeRun, lastSync);
      renderLastSyncResult(syncLastResultEl, lastSync);
      renderClearAction(clearActionRefs, lastSync, activeRun);
      await renderErrorLog();
      syncBookmarksBtn.disabled = !!activeRun?.isRunning;
      clearBookmarksBtn.disabled = !!activeRun?.isRunning;
    } catch (_error) {
      lastResultEl.textContent = "최근 저장: 상태 읽기 실패";
      syncLastResultEl.textContent = "최근 일괄 동기화: 상태 읽기 실패";
      syncStatusEl.textContent = "실행 상태 읽기 실패.";
      renderClearAction(clearActionRefs, null, null);
    }
  }
});

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });
}

function isValidAbsolutePath(value) {
  return value.startsWith("/") || value.startsWith("~/");
}

function sanitizeNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

async function renderErrorLog() {
  try {
    const response = await sendMessage({ type: "GET_RETRY_QUEUE" });
    const items = response?.items || [];
    const failed = items
      .filter((item) => item.status === "failed")
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 10);

    if (failed.length === 0) {
      errorLogEmptyEl.classList.remove("is-hidden");
      errorLogListEl.classList.add("is-hidden");
      retryFailedBtn.classList.add("is-hidden");
      return;
    }

    errorLogEmptyEl.classList.add("is-hidden");
    errorLogListEl.classList.remove("is-hidden");
    retryFailedBtn.classList.remove("is-hidden");

    errorLogListEl.innerHTML = "";
    for (const item of failed) {
      const li = document.createElement("li");
      li.className = "error-log-item";

      const urlDiv = document.createElement("div");
      urlDiv.className = "error-log-url";
      urlDiv.textContent = truncateUrl(item.payload?.url || "", 55);

      const reasonDiv = document.createElement("div");
      reasonDiv.className = "error-log-reason";
      reasonDiv.textContent = item.lastError || "알 수 없는 오류";

      const timeDiv = document.createElement("div");
      timeDiv.className = "error-log-time";
      timeDiv.textContent = item.updatedAt
        ? new Date(item.updatedAt).toLocaleString("ko-KR", { hour12: false })
        : "";

      li.appendChild(urlDiv);
      li.appendChild(reasonDiv);
      li.appendChild(timeDiv);
      errorLogListEl.appendChild(li);
    }
  } catch (_error) {
    errorLogEmptyEl.classList.remove("is-hidden");
    errorLogListEl.classList.add("is-hidden");
  }
}

function renderSyncStatus(target, activeRun, lastSync) {
  if (activeRun?.isRunning) {
    target.textContent = activeRun.statusLine || "실행 중...";
    return;
  }

  if (lastSync?.ok) {
    target.textContent = formatSyncSummary(lastSync);
    return;
  }

  if (lastSync?.error) {
    target.textContent = "동기화 실패: " + lastSync.error;
    return;
  }

  target.textContent = "실행 중에는 X 북마크 페이지 우측 상단에 상시 진행 패널이 표시됩니다.";
}

function formatSyncSummary(result) {
  const parts = [
    `목표 ${result.targetItems || result.attempted || 0}개`,
    `실제 처리 ${result.attempted || 0}개`,
    `신규 ${result.saved || 0}`,
    `중복 제거 ${result.deduped || 0}`,
  ];
  if (result.fallback) {
    parts.push(`폴백 ${result.fallback}`);
  }
  if (result.failed) {
    parts.push(`실패 ${result.failed}`);
    if (result.topErrors?.length) {
      const topError = result.topErrors[0];
      parts.push(`주요 원인 ${topError.message} ×${topError.count}`);
    }
  }
  if (result.stoppedReason) {
    parts.push(`사유: ${describeSyncStopReason(result.stoppedReason)}`);
  }
  return parts.join(", ");
}

function renderLastSyncResult(target, result) {
  if (!result) {
    target.textContent = "최근 일괄 동기화: 기록 없음.";
    return;
  }

  const when = result.timestamp
    ? new Date(result.timestamp).toLocaleString("ko-KR", { hour12: false })
    : "알 수 없는 시간";

  if (!result.ok) {
    target.textContent = `최근 일괄 동기화 실패: ${when} ${result.error || ""}`;
    return;
  }

  const summary = [when, formatSyncSummary(result)];
  target.textContent = "최근 일괄 동기화: " + summary.join(", ");
}

function renderClearAction(refs, syncResult, activeRun) {
  refs.button.classList.remove("is-hidden");

  if (activeRun?.isRunning) {
    refs.container.classList.remove("is-hidden");
    refs.prompt.textContent = activeRun.phase === "clear"
      ? "이번 회차 성공 북마크를 삭제하는 중..."
      : "동기화 진행 중입니다. 완료 후 성공한 북마크를 삭제할 수 있습니다.";
    refs.status.textContent = activeRun.statusLine || "";
    refs.button.classList.add("is-hidden");
    return;
  }

  if (!syncResult?.ok) {
    refs.container.classList.add("is-hidden");
    refs.prompt.textContent = "이번 회차 동기화 완료 후, 성공한 북마크를 삭제할 수 있습니다.";
    refs.status.textContent = "실수 방지를 위해 기본값은 자동 삭제 안 함입니다.";
    refs.button.textContent = "이번 회차 성공 북마크 삭제";
    return;
  }

  const clearableCount = getClearCandidateCount(syncResult.clearableItems, syncResult.clearableUrls);
  const pendingCount = getClearCandidateCount(syncResult.pendingClearItems, syncResult.pendingClearUrls);
  const clearResult = syncResult.clearResult;

  if (clearableCount === 0 && !clearResult) {
    refs.container.classList.add("is-hidden");
    return;
  }

  refs.container.classList.remove("is-hidden");

  if (pendingCount > 0) {
    refs.prompt.textContent = `이번 회차에 ${clearableCount || pendingCount}개의 북마크를 삭제할 수 있으며, 현재 ${pendingCount}개 남았습니다.`;
    refs.button.textContent = pendingCount === clearableCount
      ? `이번 회차 성공 북마크 삭제(${pendingCount})`
      : `남은 북마크 계속 삭제(${pendingCount})`;
    refs.button.classList.remove("is-hidden");
  } else {
    refs.prompt.textContent = `이번 회차 ${clearableCount}개의 삭제 가능 북마크 처리가 완료되었습니다.`;
    refs.button.classList.add("is-hidden");
  }

  if (!clearResult) {
    refs.status.textContent = "실수 방지를 위해 기본값은 자동 삭제 안 함입니다.";
    return;
  }

  const summary = [
    `최근 삭제: ${clearResult.cleared || 0}개 삭제됨`,
    `남은 ${getClearCandidateCount(clearResult.remainingItems, clearResult.remainingUrls)}개`,
  ];
  if (clearResult.failed) {
    summary.push(`실패 ${clearResult.failed}`);
  }
  if (clearResult.topErrors?.length) {
    const topError = clearResult.topErrors[0];
    summary.push(`주요 원인: ${topError.message} ×${topError.count}`);
  }
  if (clearResult.stoppedReason) {
    summary.push(`사유: ${describeClearStopReason(clearResult.stoppedReason)}`);
  }
  refs.status.textContent = summary.join(", ");
}

function describeSyncStopReason(reason) {
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

function describeClearStopReason(reason) {
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

function updateFilenamePreview() {
  const template = filenameTemplateEl.value.trim() || DEFAULT_FILENAME_TEMPLATE;
  const now = new Date();
  const sample = template
    .replace(/\{title\}/g, "게시글 제목")
    .replace(/\{date\}/g, now.toISOString().slice(0, 10))
    .replace(/\{author\}/g, "authorhandle")
    .replace(/\{id\}/g, "1234567890")
    .replace(/\{source\}/g, "x-bookmark");
  filenamePreviewEl.textContent = "미리보기: " + sample + ".md";
}

function truncateUrl(url, maxLength) {
  if (!url) return "";
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength - 3) + "...";
}

function getClearCandidateCount(primary, fallback) {
  if (Array.isArray(primary)) {
    return primary.length;
  }
  if (Array.isArray(fallback)) {
    return fallback.length;
  }
  return 0;
}
