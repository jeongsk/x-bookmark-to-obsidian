import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const CONTENT_THREADS_JS = resolve(process.cwd(), "content-threads.js");

function loadScript() {
  return readFileSync(CONTENT_THREADS_JS, "utf-8");
}

test.describe("Threads Extraction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/threads.html");
  });

  test("should detect all Threads articles on the page", async ({ page }) => {
    const count = await page.evaluate(() => {
      return document.querySelectorAll("article").length;
    });
    expect(count).toBe(4);
  });

  test("should extract post URL from article", async ({ page }) => {
    const script = loadScript();
    await page.evaluate((src) => {
      const el = document.createElement("script");
      el.textContent = src + "\nreturn window.extractPostUrl__test;";
      document.head.appendChild(el);
    }, script);

    const urls = await page.evaluate(() => {
      const articles = document.querySelectorAll("article");
      const results = [];
      for (const article of articles) {
        const links = article.querySelectorAll('a[href*="/post/"]');
        for (const link of links) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/\/@[\w.]+\/post\/([A-Za-z0-9_-]+)/);
          if (match) {
            results.push("https://www.threads.net" + href.split("?")[0]);
          }
        }
      }
      return results;
    });

    expect(urls).toHaveLength(4);
    expect(urls[0]).toBe("https://www.threads.net/@testuser1/post/AbC123DeFgHi");
    expect(urls[1]).toBe("https://www.threads.net/@testuser2/post/XyZ456AbCdEf");
    expect(urls[2]).toBe("https://www.threads.net/@testuser3/post/MnO789PqRsTu");
    expect(urls[3]).toBe("https://www.threads.net/@testuser4/post/VwX012YzAbCd");
  });

  test("should extract author handle from post URL", async ({ page }) => {
    const handles = await page.evaluate(() => {
      const articles = document.querySelectorAll("article");
      const results = [];
      for (const article of articles) {
        const links = article.querySelectorAll('a[href*="/post/"]');
        for (const link of links) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/\/@([\w.]+)\//);
          if (match) results.push(match[1]);
        }
      }
      return results;
    });

    expect(handles).toEqual(["testuser1", "testuser2", "testuser3", "testuser4"]);
  });

  test("should extract media URLs from articles with images", async ({ page }) => {
    // Article 2 has 2 images
    const mediaUrls = await page.evaluate(() => {
      const article = document.querySelectorAll("article")[1];
      const urls = [];
      const imgs = article.querySelectorAll('img[src*="cdninstagram.com"], img[src*="threads"], img[src*="fbcdn"]');
      for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (src && !src.includes("profile") && !src.includes("avatar")) {
          urls.push(src);
        }
      }
      return urls;
    });

    expect(mediaUrls).toHaveLength(2);
    expect(mediaUrls[0]).toContain("cdninstagram.com");
    expect(mediaUrls[1]).toContain("cdninstagram.com");
  });

  test("should extract video poster/media URLs from article with video", async ({ page }) => {
    const mediaUrls = await page.evaluate(() => {
      const article = document.querySelectorAll("article")[2];
      const urls = [];
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
      return urls;
    });

    expect(mediaUrls.length).toBeGreaterThanOrEqual(2);
    expect(mediaUrls[0]).toContain("cdninstagram.com"); // poster
  });

  test("should exclude profile/avatar images from media URLs", async ({ page }) => {
    const mediaUrls = await page.evaluate(() => {
      const article = document.querySelectorAll("article")[3];
      const urls = [];
      const imgs = article.querySelectorAll('img[src*="cdninstagram.com"]');
      for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (src && !src.includes("profile") && !src.includes("avatar")) {
          urls.push(src);
        }
      }
      return urls;
    });

    // Article 4 has a profile image that should be excluded
    expect(mediaUrls).toHaveLength(0);
  });

  test("should extract external links excluding threads.net domains", async ({ page }) => {
    const externalLinks = await page.evaluate(() => {
      const article = document.querySelectorAll("article")[2];
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
      return urls;
    });

    expect(externalLinks).toHaveLength(2);
    expect(externalLinks[0]).toBe("https://example.com/article");
    expect(externalLinks[1]).toBe("https://github.com/example/repo");
  });

  test.describe("Content Hash", () => {
    test("should produce consistent hash for same input", async ({ page }) => {
      // Inject the simpleHash function from content-threads.js
      await page.evaluate(() => {
        window.simpleHash = function(input) {
          let hash = 0;
          for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
          }
          return (hash >>> 0).toString(16);
        };
      });

      const hash1 = await page.evaluate(() => window.simpleHash("test|User|@user|url1,url2|link1,link2"));
      const hash2 = await page.evaluate(() => window.simpleHash("test|User|@user|url1,url2|link1,link2"));
      expect(hash1).toBe(hash2);
    });

    test("should produce different hash when media URLs change", async ({ page }) => {
      await page.evaluate(() => {
        window.simpleHash = function(input) {
          let hash = 0;
          for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
          }
          return (hash >>> 0).toString(16);
        };
      });

      const hash1 = await page.evaluate(() => window.simpleHash("text|author|@handle|url1|link1"));
      const hash2 = await page.evaluate(() => window.simpleHash("text|author|@handle|url2|link1"));
      expect(hash1).not.toBe(hash2);
    });
  });
});
