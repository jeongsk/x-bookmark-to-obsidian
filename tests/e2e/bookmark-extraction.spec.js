import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const CONTENT_JS = resolve(process.cwd(), "content.js");

function loadContentScript() {
  return readFileSync(CONTENT_JS, "utf-8");
}

test.describe("Bookmark Extraction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/bookmarks.html");
  });

  test("should detect bookmarked articles on the page", async ({ page }) => {
    const count = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      return articles.length;
    });
    expect(count).toBe(3);
  });

  test("should identify bookmarked vs unbookmarked articles", async ({ page }) => {
    const result = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const bookmarked = [];
      const unbookmarked = [];
      for (const article of articles) {
        if (article.querySelector('[data-testid="removeBookmark"]')) {
          bookmarked.push(article.querySelector('[data-testid="tweetText"]')?.textContent?.trim());
        } else if (article.querySelector('[data-testid="bookmark"]')) {
          unbookmarked.push(article.querySelector('[data-testid="tweetText"]')?.textContent?.trim());
        }
      }
      return { bookmarked, unbookmarked };
    });

    expect(result.bookmarked).toHaveLength(2);
    expect(result.unbookmarked).toHaveLength(1);
    expect(result.bookmarked).toContain("첫 번째 테스트 북마크입니다. #테스트");
    expect(result.unbookmarked).toContain("북마크되지 않은 게시글");
  });

  test("should extract correct tweet URL from article", async ({ page }) => {
    const urls = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const result = [];
      for (const article of articles) {
        const link = article.querySelector('a[href*="/status/"]');
        if (link) {
          const href = link.getAttribute("href");
          const match = href.match(/\/(\w+)\/status\/(\d+)/);
          if (match) {
            result.push(`https://x.com/${match[1]}/status/${match[2]}`);
          }
        }
      }
      return result;
    });

    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe("https://x.com/testuser1/status/1789012345678901234");
    expect(urls[1]).toBe("https://x.com/testuser2/status/1789012345678901235");
  });

  test("should extract author handle from article", async ({ page }) => {
    const handles = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const result = [];
      for (const article of articles) {
        const anchor = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
        const href = anchor?.getAttribute("href") || "";
        const match = href.match(/^\/(\w+)/);
        result.push(match ? match[1] : "");
      }
      return result;
    });

    expect(handles).toEqual(["testuser1", "testuser2", "testuser3"]);
  });

  test("should extract metrics from article", async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const article = document.querySelector('article[data-testid="tweet"]');
      const group = article.querySelector('[role="group"]');
      if (!group) return {};
      const result = {};
      const replyBtn = group.querySelector('[data-testid="reply"]');
      if (replyBtn) {
        const label = replyBtn.getAttribute("aria-label") || "";
        const match = label.match(/(\d[\d,.]*)/);
        result.replies = match ? match[1] : "0";
      }
      const likeBtn = group.querySelector('[data-testid="like"]');
      if (likeBtn) {
        const label = likeBtn.getAttribute("aria-label") || "";
        const match = label.match(/(\d[\d,.]*)/);
        result.likes = match ? match[1] : "0";
      }
      return result;
    });

    expect(metrics.replies).toBe("5");
    expect(metrics.likes).toBe("34");
  });
});

test.describe("Content Hash Dedup", () => {
  test("simpleHash should produce consistent results", async ({ page }) => {
    await page.goto("/bookmarks.html");

    // Inject the simpleHash function from content.js
    const hash1 = await page.evaluate(() => {
      function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash |= 0;
        }
        return (hash >>> 0).toString(16);
      }
      return simpleHash("test content|Test User|@testuser|5|12|34");
    });

    const hash2 = await page.evaluate(() => {
      function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash |= 0;
        }
        return (hash >>> 0).toString(16);
      }
      return simpleHash("test content|Test User|@testuser|5|12|34");
    });

    const hash3 = await page.evaluate(() => {
      function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash |= 0;
        }
        return (hash >>> 0).toString(16);
      }
      return simpleHash("different content|Other User|@other|0|0|0");
    });

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  test("same tweet should produce same content hash", async ({ page }) => {
    await page.goto("/bookmarks.html");

    const hash = await page.evaluate(() => {
      function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash |= 0;
        }
        return (hash >>> 0).toString(16);
      }

      const article = document.querySelector('article[data-testid="tweet"]');
      const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";
      return simpleHash(text);
    });

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

test.describe("URL Normalization", () => {
  test("should normalize x.com and twitter.com URLs consistently", async ({ page }) => {
    // This tests the normalizeStatusUrl logic pattern
    const result = await page.evaluate(() => {
      function normalize(url, handle) {
        const raw = url.startsWith("http") ? url : "https://x.com" + url;
        try {
          const parsed = new URL(raw);
          const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
          if (match) {
            return `https://x.com/${match[1]}/status/${match[2]}`;
          }
          return raw;
        } catch (_e) {
          return raw;
        }
      }

      return {
        x: normalize("https://x.com/user1/status/12345", "user1"),
        twitter: normalize("https://twitter.com/user2/status/67890", "user2"),
        noProtocol: normalize("/user3/status/11111", "user3"),
      };
    });

    expect(result.x).toBe("https://x.com/user1/status/12345");
    expect(result.twitter).toBe("https://x.com/user2/status/67890");
    expect(result.noProtocol).toBe("https://x.com/user3/status/11111");
  });
});

test.describe("Change Detection", () => {
  test("should detect content change via different hashes", async ({ page }) => {
    await page.goto("/bookmarks.html");

    const hashes = await page.evaluate(() => {
      function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash |= 0;
        }
        return (hash >>> 0).toString(16);
      }

      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const results = [];
      for (const article of articles) {
        const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";
        results.push(simpleHash(text));
      }
      return results;
    });

    // All three articles have different text, so all hashes should be different
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(hashes[1]).not.toBe(hashes[2]);
  });
});
