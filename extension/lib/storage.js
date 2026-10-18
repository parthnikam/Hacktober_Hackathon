import { emptyNotebook, normalizeNotebook } from "./notebook.js";

export const GEMINI_API_KEY = "geminiApiKey";
export const LAST_CLUSTER_KEY = "lastCluster";
export const MEM0_API_KEY = "mem0ApiKey";
export const MEM0_USER_ID = "mem0UserId";
export const NOTEBOOK_KEY = "notebook";
export const DEFAULT_MEM0_USER_ID = "local-user";

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

export async function getMem0ApiKey() {
  const stored = await chrome.storage.local.get(MEM0_API_KEY);
  return String(stored[MEM0_API_KEY] || "").trim();
}

export async function setMem0ApiKey(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    await chrome.storage.local.remove(MEM0_API_KEY);
    return;
  }
  await chrome.storage.local.set({ [MEM0_API_KEY]: trimmed });
}

export async function getMem0UserId() {
  const stored = await chrome.storage.local.get(MEM0_USER_ID);
  return String(stored[MEM0_USER_ID] || "").trim() || DEFAULT_MEM0_USER_ID;
}

export async function setMem0UserId(userId) {
  const trimmed = String(userId || "").trim() || DEFAULT_MEM0_USER_ID;
  await chrome.storage.local.set({ [MEM0_USER_ID]: trimmed });
}

export async function getNotebook() {
  const stored = await chrome.storage.local.get(NOTEBOOK_KEY);
  return normalizeNotebook(stored[NOTEBOOK_KEY]);
}

export async function saveNotebook(notebook) {
  await chrome.storage.local.set({ [NOTEBOOK_KEY]: normalizeNotebook(notebook || emptyNotebook()) });
}
