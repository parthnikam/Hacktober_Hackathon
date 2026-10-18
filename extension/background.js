import { answerFromMemories, clusterTabs, testGeminiKey } from "./lib/gemini.js";
import { addMemories, searchMemories, testMem0Key } from "./lib/memory.js";
import {
  acceptTrail,
  mentionedProjectIds,
  recallLocally,
  searchFilters,
  suggestionsFromCluster,
  timeRange,
  moveLink as moveNotebookLink,
  withoutTrail,
} from "./lib/notebook.js";
import {
  getGeminiApiKey,
  getLastCluster,
  getMem0ApiKey,
  getMem0UserId,
  getNotebook,
  saveLastCluster,
  saveNotebook,
} from "./lib/storage.js";
import { collectTabs, safeIcon, shouldSkipUrl } from "./lib/tabs.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (type === "cluster-tabs") {
    reply(sendResponse, runCluster);
    return true;
  }
  if (type === "test-gemini") {
    reply(sendResponse, () => testGeminiKey(message.apiKey));
    return true;
  }
  if (type === "test-mem0") {
    reply(sendResponse, () => testMem0Key(message.apiKey));
    return true;
  }
  if (type === "get-state") {
    reply(sendResponse, getState);
    return true;
  }
  if (type === "accept-suggestion") {
    reply(sendResponse, () => acceptSuggestion(message.key));
    return true;
  }
  if (type === "move-link") {
    reply(sendResponse, () => moveLink(message.linkId, message.projectId));
    return true;
  }
  if (type === "ask-memory") {
    reply(sendResponse, () => askMemory(message.question));
    return true;
  }
  if (type === "focus-tab") {
    reply(sendResponse, () => focusTab(message.tabId));
    return true;
  }
  return false;
});

function reply(sendResponse, task) {
  Promise.resolve()
    .then(task)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
}

async function getState() {
  const [notebook, cluster, tabs] = await Promise.all([getNotebook(), getLastCluster(), listOpenTabs()]);
  return { notebook, cluster, tabs };
}

async function listOpenTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => !shouldSkipUrl(tab.url))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || tab.url || "Untitled",
      url: tab.url || "",
      favIconUrl: safeIcon(tab.favIconUrl),
    }));
}

const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

async function runCluster() {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error("Add a Gemini API key in the options page.");
  const tabs = await collectTabs();
  const result = await clusterTabs(apiKey, tabs);
  await saveLastCluster(result);
  try {
    result.chromeGroups = await applyChromeGroups(result);
  } catch (error) {
    result.chromeGroups = 0;
    result.groupError = errorMessage(error);
  }
  return result;
}

async function applyChromeGroups(cluster) {
  const open = await chrome.tabs.query({});
  const windows = new Map(open.map((tab) => [tab.id, tab.windowId]));
  const colors = [...GROUP_COLORS].sort(() => Math.random() - 0.5);
  let colorIndex = 0;
  let made = 0;

  for (const trail of cluster?.trails || []) {
    const byWindow = new Map();
    for (const id of trail.tab_ids || []) {
      const windowId = windows.get(Number(id));
      if (windowId == null) continue;
      const list = byWindow.get(windowId) || [];
      list.push(Number(id));
      byWindow.set(windowId, list);
    }
    if (byWindow.size === 0) continue;
    const color = colors[colorIndex % colors.length];
    colorIndex += 1;
    for (const [windowId, tabIds] of byWindow) {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: trail.label || "Group",
        color,
      });
      made += 1;
    }
  }
  return made;
}

async function acceptSuggestion(key) {
  const cluster = await getLastCluster();
  const suggestion = suggestionsFromCluster(cluster).find((item) => item.key === key);
  if (!suggestion) throw new Error("That suggestion is no longer available.");
  const trail = (cluster?.trails || []).find((item, index) => suggestionsFromCluster(cluster)[index]?.key === key);
  const notebook = await getNotebook();
  const filed = acceptTrail(notebook, trail, cluster?.tabs || []);
  await saveNotebook(filed.notebook);
  await saveLastCluster(withoutTrail(cluster, key));
  const memory = await remember(filed.memories);
  return {
    project: filed.project,
    created: filed.created,
    linkCount: filed.links.length,
    remembered: memory.remembered,
    warning: memory.warning || "",
  };
}

async function moveLink(linkId, projectId) {
  const notebook = await getNotebook();
  const moved = moveNotebookLink(notebook, linkId, projectId);
  if (!moved.moved) throw new Error("That link is already in this project.");
  await saveNotebook(moved.notebook);
  const memory = await remember(moved.memories);
  return {
    link: moved.link,
    remembered: memory.remembered,
    warning: memory.warning || "",
  };
}

async function remember(memories) {
  if (!memories?.length) return { remembered: false };
  const apiKey = await getMem0ApiKey();
  if (!apiKey) return { remembered: false, warning: "Filed on this computer. Add a Mem0 key to remember it later." };
  try {
    await addMemories(apiKey, await getMem0UserId(), memories);
    return { remembered: true };
  } catch (error) {
    return { remembered: false, warning: errorMessage(error) };
  }
}

async function askMemory(question) {
  const text = String(question || "").trim();
  if (!text) throw new Error("Type a question first.");
  const notebook = await getNotebook();
  const range = timeRange(text);
  const projectIds = mentionedProjectIds(notebook, text);
  const local = recallLocally(notebook, text);
  let remote = [];
  let warning = "";
  const apiKey = await getMem0ApiKey();
  if (apiKey) {
    try {
      const filters = searchFilters({ userId: await getMem0UserId(), projectIds, range });
      const found = await searchMemories(apiKey, text, filters);
      remote = found.results;
    } catch (error) {
      warning = errorMessage(error);
    }
  } else {
    warning = "No Mem0 key yet. This answer uses what is filed on this computer.";
  }
  const memories = mergeMemories(local, remote);
  const answer = await answerFromMemories(await getGeminiApiKey(), text, memories);
  const projects = [
    ...new Set(memories.map((memory) => memory?.metadata?.project_name).filter(Boolean)),
  ];
  return { text: answer.text, projects, warning };
}

function mergeMemories(local, remote) {
  const merged = [];
  const seen = new Set();
  for (const memory of [...local, ...remote]) {
    const text = String(memory?.memory || memory?.sentence || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    merged.push(memory.memory ? memory : { ...memory, memory: text });
  }
  return merged;
}

async function focusTab(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) throw new Error("That tab is no longer open.");
  const tab = await chrome.tabs.get(id);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(id, { active: true });
  return { id };
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
