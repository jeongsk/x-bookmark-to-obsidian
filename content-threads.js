(function () {
  "use strict";

  const BUTTON_CLASS = "xbtl-threads-save-btn";
  const TOAST_ID = "x-bookmark-to-obsidian-toast-root";
  const PENDING_TTL_MS = 10000;
  const PENDING_BY_URL = new Map();

  const POST_LINK_SELECTOR = 'a[href*="/post/"]';
  const PROCESSED_CONTAINERS = new WeakSet();

  let observer = null;

  function init() {
    injectStyles();
    scanExistingPosts();
    observeNewPosts();
  }

  function injectStyles() {
    if (document.getElementById("xbtl-threads-styles")) return;
    const style = document.createElement("style");
    style.id = "xbtl-threads-styles";
    style.textContent = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        transition: background 0.15s;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover {
        background: rgba(29, 155, 240, 0.1);
      }
      .${BUTTON_CLASS} svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
      }
      .${BUTTON_CLASS}.xbtl-saved svg {
        fill: currentColor;
      }
      .xbtl-threads-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        color: #fff;
        padding: 10px 20px;
        border-radius: 12px;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        animation: xbtl-fade-in 0.2s ease;
      }
      .xbtl-threads-toast.xbtl-error {
        background: #dc2626;
      }
      @keyframes xbtl-fade-in {
        from { opacity: 0; transform: translateX(-50%) translateY(8px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  function observeNewPosts() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const links = node.matches?.(POST_LINK_SELECTOR)
            ? [node]
            : Array.from(node.querySelectorAll?.(POST_LINK_SELECTOR) || []);
          for (const link of links) {
            processPostLink(link);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scanExistingPosts() {
    const links = document.querySelectorAll(POST_LINK_SELECTOR);
    for (const link of links) {
      processPostLink(link);
    }
  }

  function processPostLink(link) {
    const postUrl = extractPostUrlFromLink(link);
    if (!postUrl) return;

    const container = findPostContainer(link);
    if (!container || PROCESSED_CONTAINERS.has(container)) return;
    PROCESSED_CONTAINERS.add(container);

    const actionBar = findActionBar(container);
    if (!actionBar || actionBar.querySelector(`.${BUTTON_CLASS}`)) return;

    attachSaveButton(actionBar, postUrl, container);
  }

  function extractPostUrlFromLink(link) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/\/@[\w.]+\/post\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    return "https://www.threads.com" + href.split("?")[0];
  }

  function findPostContainer(link) {
    let el = link.parentElement;
    while (el && el !== document.body) {
      const textLen = (el.innerText || "").length;
      if (textLen > 60 && textLen < 5000 && el.children.length >= 3) {
        return el;
      }
      el = el.parentElement;
    }
    return link.closest("div") || link.parentElement;
  }

  function findActionBar(container) {
    // Threads action bar: contains 4-5 clickable divs/SVGs (like, comment, repost, send)
    const allDivs = container.querySelectorAll("div");
    let bestCandidate = null;
    let bestScore = 0;

    for (const div of allDivs) {
      const svgs = div.querySelectorAll("svg");
      if (svgs.length < 3 || svgs.length > 6) continue;

      const parent = div.parentElement;
      if (!parent) continue;

      const parentSvgCount = parent.querySelectorAll("svg").length;
      if (parentSvgCount === svgs.length) continue; // Same count means div IS the parent

      const score = svgs.length;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = div;
      }
    }

    return bestCandidate;
  }

  function attachSaveButton(actionBar, postUrl, container) {
    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.title = "Obsidian에 저장";
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleSaveClick(container, postUrl, btn);
    });

    actionBar.appendChild(btn);
  }

  function extractPostId(url) {
    const match = url.match(/\/post\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : "";
  }

  async function handleSaveClick(container, postUrl, btn) {
    const urlKey = normalizeUrl(postUrl);
    if (PENDING_BY_URL.has(urlKey)) return;

    PENDING_BY_URL.set(urlKey, true);
    setTimeout(() => PENDING_BY_URL.delete(urlKey), PENDING_TTL_MS);

    const payload = extractPayload(container, postUrl);
    if (!payload?.url) {
      showToast("게시글 링크를 식별하지 못했습니다.", "error");
      PENDING_BY_URL.delete(urlKey);
      return;
    }

    btn.classList.add("xbtl-saved");
    try {
      const result = await sendRuntimeMessage({ type: "SAVE_THREADS_BOOKMARK", payload });
      if (result?.success) {
        if (result.result?.deduped) {
          showToast("이미 Obsidian에 저장된 게시글입니다.");
        } else {
          showToast("Obsidian에 저장되었습니다.");
        }
      } else {
        showToast("저장 실패: " + (result?.error || "알 수 없는 오류"), "error");
        btn.classList.remove("xbtl-saved");
      }
    } catch (error) {
      showToast("저장 실패: " + (error?.message || "알 수 없는 오류"), "error");
      btn.classList.remove("xbtl-saved");
    }
  }

  function extractPayload(container, postUrl) {
    const text = extractText(container);
    const authorHandle = extractHandle(postUrl);
    const authorName = extractAuthor(container, authorHandle);
    const timeEl = container.querySelector("time");
    const postId = extractPostId(postUrl);
    const mediaUrls = extractMediaUrls(container);
    const externalLinks = extractExternalLinks(container);

    const contentHash = simpleHash([
      text,
      authorName,
      authorHandle,
      mediaUrls.join(","),
      externalLinks.join(","),
    ].join("|"));

    return {
      url: postUrl,
      tweet_id: postId,
      author_handle: authorHandle,
      author_name: authorName,
      text,
      published_at: timeEl?.getAttribute("datetime") || "",
      captured_at: new Date().toISOString(),
      source: "threads-bookmark-click",
      platform: "threads",
      metrics: {},
      media_urls: mediaUrls,
      external_links: externalLinks,
      content_hash: contentHash,
    };
  }

  function extractMediaUrls(container) {
    const urls = [];
    const imgs = container.querySelectorAll('img[src*="cdninstagram.com"], img[src*="threads"], img[src*="fbcdn"]');
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (src && !src.includes("profile") && !src.includes("avatar")) {
        urls.push(src);
      }
    }
    const videos = container.querySelectorAll("video");
    for (const video of videos) {
      const poster = video.getAttribute("poster");
      if (poster) urls.push(poster);
      const sources = video.querySelectorAll("source");
      for (const source of sources) {
        const src = source.getAttribute("src");
        if (src) urls.push(src);
      }
    }
    return [...new Set(urls)];
  }

  function extractExternalLinks(container) {
    const urls = [];
    const links = container.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href) continue;
      try {
        const u = new URL(href.startsWith("http") ? href : "https://www.threads.com" + href);
        if (!u.hostname.includes("threads.com") && !u.hostname.includes("threads.net") && !u.hostname.includes("instagram.com")) {
          urls.push(u.href);
        }
      } catch (_e) {}
    }
    return [...new Set(urls)];
  }

  function extractText(container) {
    // Threads post text: find spans with readable length, prefer the main content
    const spans = container.querySelectorAll("span");
    let longest = "";
    for (const span of spans) {
      const t = (span.innerText || "").trim();
      // Skip handles, timestamps, action button counts
      if (t.length > longest.length && !/^@\w/.test(t) && !/^\d+[hmd]/.test(t) && !/^\d+$/.test(t) && t.length > 2) {
        longest = t;
      }
    }
    // Fallback: get text from the first non-link, non-time content area
    if (!longest) {
      const divs = container.querySelectorAll("div");
      for (const div of divs) {
        const text = (div.innerText || "").trim();
        if (text.length > 10 && text.length < 4000 && !div.querySelector("time") && !div.querySelector("svg")) {
          longest = text;
          break;
        }
      }
    }
    return longest.slice(0, 4000);
  }

  function extractAuthor(container, handle) {
    // Look for span containing the handle text (typically near the top of the post)
    const spans = container.querySelectorAll("span");
    for (const span of spans) {
      const text = (span.innerText || "").trim();
      if (text === handle || text === "@" + handle) {
        // The author name is typically in a sibling or nearby span
        const parent = span.parentElement;
        if (parent) {
          const siblings = parent.querySelectorAll("span");
          for (const sib of siblings) {
            const sibText = (sib.innerText || "").trim();
            if (sibText && sibText !== text && sibText.length < 60 && !sibText.startsWith("@") && !/^\d/.test(sibText)) {
              return sibText.slice(0, 200);
            }
          }
        }
      }
    }
    // Fallback: find any short text that looks like a name (not handle, not numeric)
    for (const span of spans) {
      const text = (span.innerText || "").trim();
      if (text && text.length < 60 && text.length > 1 && !text.startsWith("@") && !/^\d+[hmd]/.test(text) && !/^\d+$/.test(text) && !text.includes("·")) {
        return text.slice(0, 200);
      }
    }
    return handle || "";
  }

  function extractHandle(postUrl) {
    const match = postUrl.match(/\/@([\w.]+)\//);
    return match ? match[1] : "";
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url.startsWith("http") ? url : "https://www.threads.com" + url);
      return u.origin + u.pathname.split("?")[0];
    } catch (_e) {
      return url;
    }
  }

  function simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return (hash >>> 0).toString(16);
  }

  function sendRuntimeMessage(message) {
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

  function showToast(message, type) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "xbtl-threads-toast" + (type === "error" ? " xbtl-error" : "");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
