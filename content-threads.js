(function () {
  "use strict";

  const BUTTON_CLASS = "xbtl-threads-save-btn";
  const TOAST_ID = "x-bookmark-to-obsidian-toast-root";
  const PENDING_TTL_MS = 10000;
  const PENDING_BY_URL = new Map();

  let observer = null;

  function init() {
    injectStyles();
    observePosts();
    scanExistingPosts();
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
        width: 24px;
        height: 24px;
        border: none;
        background: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        transition: background 0.15s;
      }
      .${BUTTON_CLASS}:hover {
        background: rgba(29, 155, 240, 0.1);
      }
      .${BUTTON_CLASS} svg {
        width: 16px;
        height: 16px;
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

  function observePosts() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const articles = node.matches?.("article") ? [node] : node.querySelectorAll?.("article") || [];
          for (const article of articles) {
            attachSaveButton(article);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scanExistingPosts() {
    for (const article of document.querySelectorAll("article")) {
      attachSaveButton(article);
    }
  }

  function attachSaveButton(article) {
    if (article.querySelector(`.${BUTTON_CLASS}`)) return;

    const postUrl = extractPostUrl(article);
    if (!postUrl) return;

    const actionBar = findActionBar(article);
    if (!actionBar) return;

    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.title = "Obsidian에 저장";
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleSaveClick(article, postUrl, btn);
    });

    actionBar.appendChild(btn);
  }

  function findActionBar(article) {
    // Threads action bar is typically a div with role="group" or the last flex row in the article
    const group = article.querySelector('[role="group"]');
    if (group) return group;

    // Fallback: find a horizontal flex container with multiple buttons
    const divs = article.querySelectorAll("div[style*=\"display\"], div");
    for (const div of divs) {
      const buttons = div.querySelectorAll("svg");
      if (buttons.length >= 3) return div;
    }
    return null;
  }

  function extractPostUrl(article) {
    // Threads post URLs are in links like /@username/post/POST_ID
    const links = article.querySelectorAll('a[href*="/post/"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/@[\w.]+\/post\/([A-Za-z0-9_-]+)/);
      if (match) {
        return "https://www.threads.net" + href.split("?")[0];
      }
    }
    return null;
  }

  function extractPostId(url) {
    const match = url.match(/\/post\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : "";
  }

  async function handleSaveClick(article, postUrl, btn) {
    const urlKey = normalizeUrl(postUrl);
    if (PENDING_BY_URL.has(urlKey)) return;

    PENDING_BY_URL.set(urlKey, true);
    setTimeout(() => PENDING_BY_URL.delete(urlKey), PENDING_TTL_MS);

    const payload = extractPayload(article, postUrl);
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

  function extractPayload(article, postUrl) {
    const text = extractText(article);
    const authorName = extractAuthor(article);
    const authorHandle = extractHandle(article, postUrl);
    const timeEl = article.querySelector("time");
    const postId = extractPostId(postUrl);
    const mediaUrls = extractMediaUrls(article);
    const externalLinks = extractExternalLinks(article);

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

  function extractMediaUrls(article) {
    const urls = [];
    // Images in Threads posts
    const imgs = article.querySelectorAll('img[src*="cdninstagram.com"], img[src*="threads"], img[src*="fbcdn"]');
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (src && !src.includes("profile") && !src.includes("avatar")) {
        urls.push(src);
      }
    }
    // Video posters
    const videos = article.querySelectorAll("video");
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

  function extractExternalLinks(article) {
    const urls = [];
    const links = article.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href) continue;
      try {
        const u = new URL(href.startsWith("http") ? href : "https://www.threads.net" + href);
        if (!u.hostname.includes("threads.net") && !u.hostname.includes("instagram.com")) {
          urls.push(u.href);
        }
      } catch (_e) {}
    }
    return [...new Set(urls)];
  }

  function extractText(article) {
    // Threads post text is usually in a span within the post container
    const spans = article.querySelectorAll("span");
    let longest = "";
    for (const span of spans) {
      const t = span.innerText?.trim() || "";
      if (t.length > longest.length && !t.startsWith("@") && t.length > 2) {
        longest = t;
      }
    }
    return longest.slice(0, 4000);
  }

  function extractAuthor(article) {
    // Find author name - typically in a link or strong element
    const strongEls = article.querySelectorAll("strong");
    for (const el of strongEls) {
      const text = el.innerText?.trim();
      if (text && text.length < 80) return text.slice(0, 200);
    }
    // Fallback: look for spans with short non-handle text
    const spans = article.querySelectorAll("span");
    for (const span of spans) {
      const text = span.innerText?.trim();
      if (text && text.length < 60 && !text.startsWith("@") && !text.includes("·")) {
        return text.slice(0, 200);
      }
    }
    return "";
  }

  function extractHandle(_article, postUrl) {
    const match = postUrl.match(/\/@([\w.]+)\//);
    return match ? match[1] : "";
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url.startsWith("http") ? url : "https://www.threads.net" + url);
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
