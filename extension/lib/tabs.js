const EXCERPT_TIMEOUT_MS = 4000;
const READ_CONCURRENCY = 5;

export function shouldSkipUrl(url) {
  if (!url) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  return (
    parsed.protocol === "chrome:" ||
    parsed.protocol === "chrome-extension:" ||
    parsed.protocol === "chrome-untrusted:" ||
    parsed.protocol === "edge:" ||
    parsed.protocol === "about:" ||
    parsed.protocol === "devtools:" ||
    parsed.protocol === "view-source:"
  );
}

export function excerptBudget(tabCount) {
  if (tabCount > 40) return 400;
  if (tabCount > 20) return 800;
  return 1500;
}

export function safeIcon(url) {
  if (!url) return "";
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("https://") || url.startsWith("http://")) return url;
  return "";
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out reading this tab")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function readTab(tab, budget) {
  const base = {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || "Untitled",
    url: tab.url || "",
    favIconUrl: safeIcon(tab.favIconUrl),
    excerpt: "",
  };
  // A discarded tab would reload if we injected a script. Title and URL are enough.
  if (tab.discarded) return base;

  try {
    const [injected] = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (limit) => {
          const title = document.title || "";
          const raw = document.body ? document.body.innerText : "";
          const text = raw.replace(/\s+/g, " ").trim().slice(0, limit);
          return { title, text };
        },
        args: [budget],
      }),
      EXCERPT_TIMEOUT_MS,
    );
    if (injected?.result?.title) base.title = injected.result.title;
    if (injected?.result?.text) base.excerpt = injected.result.text;
  } catch {
    // PDFs, the Chrome Web Store, and hung pages still group by title and URL.
  }
  return base;
}

export async function collectTabs() {
  const open = await chrome.tabs.query({});
  const readable = open.filter((tab) => tab.id != null && !shouldSkipUrl(tab.url));
  const budget = excerptBudget(readable.length);
  return mapPool(readable, READ_CONCURRENCY, (tab) => readTab(tab, budget));
}
