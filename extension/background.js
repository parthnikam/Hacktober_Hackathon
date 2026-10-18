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
  seedKeysFromEnv,
} from "./lib/storage.js";
import { mergeTrailGroups, projectGroups } from "./lib/groups.js";
import { collectTabs, safeIcon, shouldSkipUrl } from "./lib/tabs.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
seedKeysFromEnv().catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (type === "group-tabs" || type === "cluster-tabs") {
    reply(sendResponse, groupOpenTabs);
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

async function groupOpenTabs() {
  const notebook = await getNotebook();
  const open = await chrome.tabs.query({});
  const tabs = open.filter((tab) => tab.id != null && !tab.pinned && !shouldSkipUrl(tab.url));
  let groups = projectGroups(notebook, tabs);
  const claimed = new Set(groups.flatMap((group) => group.tabIds));
  const loose = tabs.filter((tab) => !claimed.has(tab.id));
  let warning = "";

  if (loose.length > 0) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey && groups.length === 0) {
      throw new Error("File the tabs into a project, or add a Gemma API key so they can be grouped.");
    }
    if (apiKey) {
      try {
        const collected = await collectTabs();
        const subset = collected.filter((tab) => loose.some((item) => item.id === tab.id));
        if (subset.length > 0) {
          const clustered = await clusterTabs(apiKey, subset);
          await saveLastCluster(clustered);
          groups = mergeTrailGroups(groups, clustered.trails);
        }
      } catch (error) {
        warning = errorMessage(error);
        if (groups.length === 0) throw error;
      }
    }
  }

  if (groups.length === 0) throw new Error(warning || "No open tabs could be grouped.");
  const applied = await applyChromeGroups(groups);
  const extra = [warning, applied.warning].filter(Boolean).join(" ");
  return {
    chromeGroups: applied.made,
    projects: groups.map((group) => group.title),
    warning: extra,
  };
}

async function applyChromeGroups(groups) {
  const open = await chrome.tabs.query({});
  const live = new Map(
    open.filter((tab) => tab.id != null && !tab.pinned).map((tab) => [tab.id, tab]),
  );
  const usedColors = new Set();
  const failures = [];
  let made = 0;
  for (const group of groups) {
    const byWindow = new Map();
    for (const id of group.tabIds) {
      const tab = live.get(id);
      if (!tab || tab.windowId == null) continue;
      const list = byWindow.get(tab.windowId) || [];
      list.push(tab);
      byWindow.set(tab.windowId, list);
    }
    for (const [windowId, windowTabs] of byWindow) {
      windowTabs.sort((left, right) => left.index - right.index);
      try {
        await groupTabsInWindow(
          windowId,
          windowTabs.map((tab) => tab.id),
          group.title,
          usedColors,
        );
        made += 1;
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }
  }
  if (made === 0 && failures.length > 0) throw new Error(failures[0]);
  return { made, warning: failures.join(" ") };
}

async function groupTabsInWindow(windowId, tabIds, title, usedColors) {
  const [named] = await chrome.tabGroups.query({ windowId, title });
  if (named) {
    await chrome.tabs.group({ groupId: named.id, tabIds });
    return;
  }
  const groupId = await chrome.tabs.group({
    tabIds,
    createProperties: { windowId },
  });
  const color = randomColor(usedColors);
  usedColors.add(color);
  await chrome.tabGroups.update(groupId, { title, color });
}

function randomColor(used) {
  const free = GROUP_COLORS.filter((color) => !used.has(color));
  const pool = free.length > 0 ? free : GROUP_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
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
