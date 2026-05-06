import { test, expect } from "@playwright/test";

test.describe("Threads Extraction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/threads.html");
  });

  test("should detect all Threads post links on the page", async ({ page }) => {
    const count = await page.evaluate(() => {
      return document.querySelectorAll('a[href*="/post/"]').length;
    });
    expect(count).toBe(4);
  });

  test("should extract post URL from post links", async ({ page }) => {
    const urls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/post/"]');
      const results = [];
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/@[\w.]+\/post\/([A-Za-z0-9_-]+)/);
        if (match) {
          results.push("https://www.threads.com" + href.split("?")[0]);
        }
      }
      return results;
    });

    expect(urls).toHaveLength(4);
    expect(urls[0]).toBe("https://www.threads.com/@testuser1/post/AbC123DeFgHi");
    expect(urls[1]).toBe("https://www.threads.com/@testuser2/post/XyZ456AbCdEf");
    expect(urls[2]).toBe("https://www.threads.com/@testuser3/post/MnO789PqRsTu");
    expect(urls[3]).toBe("https://www.threads.com/@testuser4/post/VwX012YzAbCd");
  });

  test("should extract author handle from post URL", async ({ page }) => {
    const handles = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/post/"]');
      const results = [];
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/\/@([\w.]+)\//);
        if (match) results.push(match[1]);
      }
      return results;
    });

    expect(handles).toEqual(["testuser1", "testuser2", "testuser3", "testuser4"]);
  });

  test("should find post containers from post links", async ({ page }) => {
    const containers = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/post/"]');
      const containers = [];
      for (const link of links) {
        let el = link.parentElement;
        while (el && el !== document.body) {
          const textLen = (el.innerText || "").length;
          if (textLen > 60 && textLen < 5000 && el.children.length >= 3) {
            containers.push({
              tag: el.tagName,
              classes: el.className?.slice(0, 30),
              textLen,
            });
            break;
          }
          el = el.parentElement;
        }
      }
      return containers;
    });

    expect(containers).toHaveLength(4);
    expect(containers[0].classes).toContain("xrvj5dj");
  });

  test("should find action bars in post containers", async ({ page }) => {
    const actionBars = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/post/"]');
      const bars = [];
      for (const link of links) {
        let container = link.parentElement;
        while (container && container !== document.body) {
          if ((container.innerText || "").length > 60 && container.children.length >= 3) break;
          container = container.parentElement;
        }
        if (!container) continue;

        const divs = container.querySelectorAll("div");
        let bestDiv = null;
        let bestScore = 0;
        for (const div of divs) {
          const svgs = div.querySelectorAll("svg");
          if (svgs.length >= 3 && svgs.length <= 6) {
            if (svgs.length > bestScore) {
              bestScore = svgs.length;
              bestDiv = div;
            }
          }
        }
        bars.push({ found: !!bestDiv, svgCount: bestScore });
      }
      return bars;
    });

    expect(actionBars).toHaveLength(4);
    for (const bar of actionBars) {
      expect(bar.found).toBe(true);
      expect(bar.svgCount).toBeGreaterThanOrEqual(3);
    }
  });

  test("should extract media URLs from containers with images", async ({ page }) => {
    const mediaUrls = await page.evaluate(() => {
      const container = document.querySelectorAll(".xrvj5dj")[1]; // Post 2
      const urls = [];
      const imgs = container.querySelectorAll('img[src*="cdninstagram.com"], img[src*="threads"], img[src*="fbcdn"]');
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

  test("should extract video poster/media URLs from container with video", async ({ page }) => {
    const mediaUrls = await page.evaluate(() => {
      const container = document.querySelectorAll(".xrvj5dj")[2]; // Post 3
      const urls = [];
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
      return urls;
    });

    expect(mediaUrls.length).toBeGreaterThanOrEqual(2);
    expect(mediaUrls[0]).toContain("cdninstagram.com"); // poster
  });

  test("should exclude profile/avatar images from media URLs", async ({ page }) => {
    const mediaUrls = await page.evaluate(() => {
      const container = document.querySelectorAll(".xrvj5dj")[3]; // Post 4
      const urls = [];
      const imgs = container.querySelectorAll('img[src*="cdninstagram.com"]');
      for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (src && !src.includes("profile") && !src.includes("avatar")) {
          urls.push(src);
        }
      }
      return urls;
    });

    expect(mediaUrls).toHaveLength(0);
  });

  test("should extract external links excluding threads.com and instagram.com", async ({ page }) => {
    const externalLinks = await page.evaluate(() => {
      const container = document.querySelectorAll(".xrvj5dj")[2]; // Post 3
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
      return urls;
    });

    expect(externalLinks).toHaveLength(2);
    expect(externalLinks[0]).toBe("https://example.com/article");
    expect(externalLinks[1]).toBe("https://github.com/example/repo");
  });

  test.describe("Content Hash", () => {
    test("should produce consistent hash for same input", async ({ page }) => {
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

    test("should produce different hash when input changes", async ({ page }) => {
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
