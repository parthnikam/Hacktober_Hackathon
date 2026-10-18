import { runAgent } from "./lib/agent.js";
import { answerFromMemories, clusterTabs, formatMemories, testGeminiKey } from "./lib/gemini.js";
import { addMemories, searchMemories, testMem0Key } from "./lib/memory.js";
import {
  acceptTrail,
  deleteProject as deleteNotebookProject,
  mentionedProjectIds,
  recallLocally,
  renameProject as renameNotebookProject,
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
import { mergeTrailGroups, projectGroups, reopenPlan, samePage } from "./lib/groups.js";
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
  if (type === "open-link") {
    reply(sendResponse, () => openSavedPage(message.url, message.projectName));
    return true;
  }
  if (type === "open-project") {
    reply(sendResponse, () => openFiledProject(message.projectId));
    return true;
  }
  if (type === "rename-project") {
    reply(sendResponse, () => renameProject(message.projectId, message.name));
    return true;
  }
  if (type === "delete-project") {
    reply(sendResponse, () => deleteFiledProject(message.projectId));
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
          const clustered = await clusterTabs(apiKey, subset, { projects: notebook.projects });
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
  if (moved.collapsed) return { collapsed: true, remembered: false, warning: "" };
  const memory = await remember(moved.memories);
  return {
    link: moved.link,
    remembered: memory.remembered,
    warning: memory.warning || "",
  };
}

async function renameProject(projectId, name) {
  const notebook = await getNotebook();
  const renamed = renameNotebookProject(notebook, projectId, name);
  if (renamed.error) throw new Error(renamed.error);
  if (!renamed.renamed) return { name: String(name || "").trim(), remembered: false, warning: "" };
  await saveNotebook(renamed.notebook);
  const memory = await remember(renamed.memories);
  return { name: renamed.project.name, remembered: memory.remembered, warning: memory.warning || "" };
}

async function deleteFiledProject(projectId) {
  const notebook = await getNotebook();
  const project = notebook.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("That project is gone.");
  await saveNotebook(deleteNotebookProject(notebook, projectId));
  return { name: project.name };
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
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    const found = await searchMemory(text);
    return {
      text: formatMemories(found.memories),
      projects: found.projects,
      sources: found.sources,
      warning: found.warning,
      filed: false,
    };
  }
  try {
    return await runAgent({
      apiKey,
      question: text,
      callTool: (name, args) => callAgentTool(name, args, text),
    });
  } catch (error) {
    const found = await searchMemory(text);
    const answer = await answerFromMemories(
      apiKey,
      text,
      found.memories.map((memory) => ({
        memory: memory.memory,
        metadata: { project_name: memory.project_name },
      })),
    );
    return {
      text: answer.text,
      projects: found.projects,
      sources: found.sources,
      warning: [errorMessage(error), found.warning].filter(Boolean).join(" "),
      filed: false,
    };
  }
}

async function callAgentTool(name, args, question) {
  if (name === "search_memory") return searchMemory(String(args?.query || question));
  if (name === "list_tabs") return listTabsForAgent();
  if (name === "file_links") return fileLinks(args);
  return { error: `Unknown tool ${name}.` };
}

async function searchMemory(query) {
  const text = String(query || "").trim();
  const notebook = await getNotebook();
  const local = recallLocally(notebook, text);
  let remote = [];
  let warning = "";
  const apiKey = await getMem0ApiKey();
  if (apiKey) {
    try {
      const found = await searchMemories(
        apiKey,
        text,
        searchFilters({
          userId: await getMem0UserId(),
          projectIds: mentionedProjectIds(notebook, text),
          range: timeRange(text),
        }),
      );
      remote = found.results;
    } catch (error) {
      warning = errorMessage(error);
    }
  } else {
    warning = "No Mem0 key yet. This answer uses what is filed on this computer.";
  }
  const memories = mergeMemories(local, remote)
    .slice(0, 12)
    .map((memory) => ({
      memory: memory.memory,
      project_name: memory.metadata?.project_name || "",
      title: memory.metadata?.title || titleFromSentence(memory.memory),
      url: memory.metadata?.url || urlFromSentence(memory.memory),
    }));
  const sources = [];
  for (const memory of memories) {
    if (!memory.url || sources.some((item) => samePage(item.url, memory.url))) continue;
    sources.push({ title: memory.title || memory.url, url: memory.url });
  }
  return {
    memories,
    sources,
    projects: [...new Set(memories.map((memory) => memory.project_name).filter(Boolean))],
    warning,
  };
}

function titleFromSentence(text) {
  const match = String(text || "").match(/saved (.+?) \(/);
  return match?.[1] || "";
}

function urlFromSentence(text) {
  const match = String(text || "").match(/\((https?:\/\/[^)\s]+)\)/);
  return match?.[1] || "";
}

async function listTabsForAgent() {
  const tabs = await collectTabs();
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      excerpt: String(tab.excerpt || "").slice(0, 400),
    })),
  };
}

async function fileLinks(args) {
  const label = String(args?.project || "").trim();
  if (!label) return { error: "Name the project to file these tabs under." };
  const ids = [...new Set((args?.tab_ids || []).map(Number))].filter((id) => Number.isInteger(id));
  if (!ids.length) return { error: "List the open tabs before filing them." };
  const open = await chrome.tabs.query({});
  const tabs = open
    .filter((tab) => ids.includes(tab.id) && !tab.pinned && !shouldSkipUrl(tab.url))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || tab.url || "Untitled",
      url: tab.url,
    }));
  if (!tabs.length) return { error: "Those tabs are not open." };
  const notebook = await getNotebook();
  const filed = acceptTrail(
    notebook,
    {
      label,
      one_liner: String(args?.intent || "").trim(),
      tab_ids: tabs.map((tab) => tab.id),
      tab_notes: [],
    },
    tabs,
  );
  await saveNotebook(filed.notebook);
  const memory = await remember(filed.memories);
  let warning = memory.warning || "";
  try {
    await applyChromeGroups([{ title: filed.project.name, tabIds: tabs.map((tab) => tab.id) }]);
  } catch (error) {
    warning = [warning, errorMessage(error)].filter(Boolean).join(" ");
  }
  return {
    filed: filed.links.length > 0 || filed.created || filed.intentChanged,
    project: filed.project.name,
    created: filed.created,
    linkCount: filed.links.length,
    sources: tabs.map((tab) => ({ title: tab.title, url: tab.url })),
    warning,
  };
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

async function openSavedPage(url, projectName) {
  const target = String(url || "").trim();
  if (!target) throw new Error("That link has no address.");
  const current = await chrome.windows.getCurrent();
  const plan = reopenPlan([{ url: target }], await chrome.tabs.query({}));
  const tab = await placePlannedTab(plan, current.id);
  if (!tab) throw new Error("Could not open that link.");
  if (projectName && !tab.pinned) await groupTabsInWindow(tab.windowId, [tab.id], projectName, new Set());
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  return { id: tab.id };
}

async function openFiledProject(projectId) {
  const notebook = await getNotebook();
  const project = (notebook.projects || []).find((item) => item.id === projectId);
  if (!project) throw new Error("That project is no longer filed.");
  const links = (notebook.links || []).filter((link) => link.project_id === projectId);
  if (!links.length) throw new Error("That project has no links to open.");
  const current = await chrome.windows.getCurrent();
  const plan = reopenPlan(links, await chrome.tabs.query({}));
  const ids = [];
  for (const item of plan.reuse) ids.push(await bringTabToWindow(item, current.id));
  for (const url of plan.create) {
    const created = await chrome.tabs.create({ url, windowId: current.id, active: false });
    ids.push(created.id);
  }
  const fresh = await chrome.tabs.query({});
  const byWindow = new Map();
  for (const id of ids) {
    const tab = fresh.find((item) => item.id === id);
    if (!tab || tab.pinned) continue;
    const list = byWindow.get(tab.windowId) || [];
    list.push(id);
    byWindow.set(tab.windowId, list);
  }
  const usedColors = new Set();
  for (const [windowId, tabIds] of byWindow) {
    await groupTabsInWindow(windowId, tabIds, project.name, usedColors);
  }
  const focusId =
    fresh.find((tab) => ids.includes(tab.id) && tab.windowId === current.id)?.id ||
    ids[0] ||
    plan.pinned[0]?.id;
  if (focusId == null) throw new Error("That project has no links to open.");
  const focus = fresh.find((tab) => tab.id === focusId) || (await chrome.tabs.get(focusId));
  await chrome.windows.update(focus.windowId, { focused: true });
  await chrome.tabs.update(focus.id, { active: true });
  return { name: project.name, opened: ids.length + plan.pinned.length };
}

async function placePlannedTab(plan, windowId) {
  if (plan.reuse[0]) {
    const id = await bringTabToWindow(plan.reuse[0], windowId);
    return chrome.tabs.get(id);
  }
  if (plan.create[0]) return chrome.tabs.create({ url: plan.create[0], windowId, active: false });
  if (plan.pinned[0]) return chrome.tabs.get(plan.pinned[0].id);
  return null;
}

async function bringTabToWindow(tab, windowId) {
  if (tab.windowId === windowId) return tab.id;
  try {
    const moved = await chrome.tabs.move(tab.id, { windowId, index: -1 });
    const next = Array.isArray(moved) ? moved[0] : moved;
    return next?.id || tab.id;
  } catch {
    return tab.id;
  }
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
