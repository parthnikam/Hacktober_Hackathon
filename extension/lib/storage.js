export const GEMINI_API_KEY = "geminiApiKey";
export const LAST_CLUSTER_KEY = "lastCluster";

export async function getGeminiApiKey() {
  const stored = await chrome.storage.local.get(GEMINI_API_KEY);
  return String(stored[GEMINI_API_KEY] || "").trim();
}

export async function setGeminiApiKey(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    await chrome.storage.local.remove(GEMINI_API_KEY);
    return;
  }
  await chrome.storage.local.set({ [GEMINI_API_KEY]: trimmed });
}

export async function getLastCluster() {
  const stored = await chrome.storage.local.get(LAST_CLUSTER_KEY);
  return stored[LAST_CLUSTER_KEY] || null;
}

export async function saveLastCluster(cluster) {
  await chrome.storage.local.set({ [LAST_CLUSTER_KEY]: cluster });
}
