import { runAgent } from "./lib/agent.js";
import {
  answerFromMemories,
  clusterTabs,
  formatMemories,
  planRecall,
  readProjectCommand,
  tabBelongsToProject,
  testGeminiKey,
} from "./lib/gemini.js";
import { addMemories, searchMemories, testMem0Key } from "./lib/memory.js";
import { speakText, transcribeClip } from "./lib/sarvam.js";
import {
  acceptTrail,
  deleteProject as deleteNotebookProject,
  descendantIds,
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
  getActiveProjectId,
  getGeminiApiKey,
  getLastCluster,
  getMem0ApiKey,
  getMem0UserId,
  getNotebook,
  getSarvamApiKey,
  saveLastCluster,
  saveNotebook,
  seedKeysFromEnv,
  setActiveProjectId,
} from "./lib/storage.js";
import {
  categoryHome,
  gatherPlan,
  isUntitledTitle,
  mergeTrailGroups,
  projectGroups,
  pullUntitled,
  reopenPlan,
  samePage,
} from "./lib/groups.js";
import { collectTabs, readTabSnapshot, safeIcon, shouldSkipUrl } from "./lib/tabs.js";
import { directTitle, isQuestion, isStopCommand, openedUnderProject, pageReady, watchDecision } from "./lib/watch.js";

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
  if (type === "clear-working-project") {
    reply(sendResponse, stopWatching);
    return true;
  }
  if (type === "transcribe") {
    reply(sendResponse, () => transcribeAudio(message.audio, message.mime));
    return true;
  }
  if (type === "speak") {
    reply(sendResponse, () => speakAnswer(message.text, message.language));
    return true;
  }
  if (type === "request-mic") {
    reply(sendResponse, requestMic);
    return true;
  }
  return false;
});

async function requestMic() {
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("mic.html"), active: true });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (granted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve({ granted });
    };
    const timer = setTimeout(() => finish(false), 120000);
    const onMessage = (message, sender) => {
      if (message?.type !== "mic-permission" || sender.tab?.id !== tab.id) return;
      finish(Boolean(message.granted));
      chrome.tabs.remove(tab.id).catch(() => {});
    };
    const onRemoved = (tabId) => {
      if (tabId === tab.id) finish(false);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function transcribeAudio(audio, mime) {
  return transcribeClip(await getSarvamApiKey(), audio, { mime });
}

async function speakAnswer(text, language) {
  return speakText(await getSarvamApiKey(), text, { language });
}

const seenTabUrl = new Map();
const tabTimers = new Map();
let judgeChain = Promise.resolve();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.status && changeInfo.url == null && changeInfo.title == null) return;
  const previous = tabTimers.get(tabId);
  if (previous) clearTimeout(previous);
  tabTimers.set(
    tabId,
    setTimeout(() => {
      tabTimers.delete(tabId);
      judgeChain = judgeChain.then(
        () => judgeTab(tabId).catch((error) => reportInternal(error, "new tab")),
        () => judgeTab(tabId).catch((error) => reportInternal(error, "new tab")),
      );
    }, 700),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  seenTabUrl.delete(tabId);
  const timer = tabTimers.get(tabId);
  if (timer) clearTimeout(timer);
  tabTimers.delete(tabId);
});

function reply(sendResponse, task) {
  Promise.resolve()
    .then(task)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: errorMessage(error),
        stack: error instanceof Error ? error.stack || "" : "",
      }),
    );
}

async function getState() {
  const [notebook, cluster, tabs, activeId] = await Promise.all([
    getNotebook(),
    getLastCluster(),
    listOpenTabs(),
    getActiveProjectId(),
  ]);
  const active = notebook.projects.find((project) => project.id === activeId);
  if (activeId && !active) await setActiveProjectId(null);
  return {
    notebook,
    cluster,
    tabs,
    activeProject: active ? { id: active.id, name: active.name } : null,
  };
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
  let groups = pullUntitled(projectGroups(notebook, tabs), tabs);
  const claimed = new Set(groups.flatMap((group) => group.tabIds));
  const loose = tabs.filter((tab) => !claimed.has(tab.id) && !isUntitledTitle(tab.title));
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
  const claimed = new Map();
  for (const group of groups) {
    for (const id of group.tabIds) claimed.set(id, group.title);
  }
  const usedColors = new Set();
  const failures = [];
  let made = 0;
  for (const group of groups) {
    try {
      const grouped = await gatherCategory(group, live, claimed, usedColors);
      if (grouped) made += 1;
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }
  if (made === 0 && failures.length > 0) throw new Error(failures[0]);
  return { made, warning: failures.join(" ") };
}

async function gatherCategory(group, live, claimed, usedColors) {
  const members = new Map();
  const add = (tab) => {
    if (!tab || tab.pinned || tab.id == null || tab.windowId == null) return;
    if (shouldSkipUrl(tab.url)) return;
    const owner = claimed.get(tab.id);
    if (owner && owner !== group.title) return;
    members.set(tab.id, tab);
  };
  for (const id of group.tabIds) add(live.get(id));
  const named = await chrome.tabGroups.query({ title: group.title });
  for (const existing of named) {
    const sitting = await chrome.tabs.query({ groupId: existing.id });
    for (const tab of sitting) add(tab);
  }
  if (members.size === 0) return false;

  const list = [...members.values()];
  const preferred = (await largestNamedGroup(named))?.windowId ?? null;
  const home = categoryHome(list, preferred);
  const plan = gatherPlan(list, home);
  const homeGroup = named.find((item) => item.windowId === home);
  const abroad = plan.groupIds.filter((id) => members.get(id)?.windowId !== home);
  try {
    if (abroad.length) await chrome.tabs.move(abroad, { windowId: home, index: plan.index });
    if (plan.groupIds.length > 1) await chrome.tabs.move(plan.groupIds, { index: plan.index });
  } catch (error) {
    let groupedAny = false;
    let lastError = error;
    for (const tab of list) {
      try {
        await groupTabsInWindow(tab.windowId, [tab.id], group.title, usedColors);
        groupedAny = true;
      } catch (again) {
        lastError = again;
      }
    }
    if (!groupedAny) throw lastError;
    return true;
  }
  try {
    await groupTabsInWindow(home, plan.groupIds, group.title, usedColors, homeGroup?.id);
  } catch {
    await groupTabsInWindow(home, plan.groupIds, group.title, usedColors);
  }
  return true;
}

async function largestNamedGroup(groups) {
  let best = null;
  let bestCount = -1;
  for (const group of groups || []) {
    const count = (await chrome.tabs.query({ groupId: group.id })).length;
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

async function joinCategory(tab, title, usedColors) {
  if (!tab || tab.pinned || tab.id == null || tab.windowId == null) return;
  const named = await chrome.tabGroups.query({ title });
  const existing = await largestNamedGroup(named);
  if (!existing) {
    await groupTabsInWindow(tab.windowId, [tab.id], title, usedColors);
    return;
  }
  if (existing.windowId !== tab.windowId) {
    try {
      await chrome.tabs.move(tab.id, { windowId: existing.windowId, index: -1 });
    } catch {
      await groupTabsInWindow(tab.windowId, [tab.id], title, usedColors);
      return;
    }
  }
  await chrome.tabs.group({ groupId: existing.id, tabIds: [tab.id] });
}

async function groupTabsInWindow(windowId, tabIds, title, usedColors, groupId) {
  if (!tabIds.length) return;
  const named = groupId ? { id: groupId } : (await chrome.tabGroups.query({ windowId, title }))[0];
  if (named) {
    await chrome.tabs.group({ groupId: named.id, tabIds });
    return;
  }
  const created = await chrome.tabs.group({
    tabIds,
    createProperties: { windowId },
  });
  const color = randomColor(usedColors);
  usedColors.add(color);
  await chrome.tabGroups.update(created, { title, color });
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
  const memory = await remember(filed.memories, { wait: false });
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
  const drop = new Set([projectId, ...descendantIds(notebook, projectId)]);
  await saveNotebook(deleteNotebookProject(notebook, projectId));
  if (drop.has(await getActiveProjectId())) await setActiveProjectId(null);
  return { name: project.name };
}

async function remember(memories, { wait = true } = {}) {
  if (!memories?.length) return { remembered: false };
  const apiKey = await getMem0ApiKey();
  if (!apiKey) return { remembered: false, warning: "Filed on this computer. Add a Mem0 key to remember it later." };
  const pending = addMemories(apiKey, await getMem0UserId(), memories).then(
    () => ({ remembered: true, warning: "" }),
    (error) => ({ remembered: false, warning: errorMessage(error) }),
  );
  if (!wait) {
    pending.then((result) => {
      if (result.warning) reportInternal(new Error(result.warning), "memory");
    });
    return { remembered: false, warning: "" };
  }
  return pending;
}

async function askMemory(question) {
  const text = String(question || "").trim();
  if (!text) throw new Error("Type a question first.");
  if (isStopCommand(text)) return stopWatching();
  const apiKey = await getGeminiApiKey();
  if (!isQuestion(text)) {
    if (!apiKey) {
      const title = directTitle(text);
      if (title) return watchProject(title, "");
      if (/\bworking on\b/i.test(text)) {
        throw new Error("Add a Gemma API key so that sentence can be turned into a project name.");
      }
    } else {
      try {
        const command = await readProjectCommand(apiKey, text, { projects: (await getNotebook()).projects });
        if (command.action === "stop") return stopWatching();
        if (command.action === "watch") return watchProject(command.title, command.intent);
      } catch (error) {
        reportInternal(error, "project name");
      }
    }
  }
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
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack || "" : "",
      filed: false,
    };
  }
}

async function callAgentTool(name, args, question) {
  if (name === "search_memory") return searchMemory(String(args?.query || question), question);
  if (name === "list_tabs") return listTabsForAgent();
  if (name === "file_links") return fileLinks(args);
  return { error: `Unknown tool ${name}.` };
}

async function searchMemory(query, original = query) {
  const asked = String(original || query || "").trim();
  const text = String(query || asked).trim();
  const notebook = await getNotebook();
  const geminiKey = await getGeminiApiKey();
  let plan = { related: true, projects: [], queries: [] };
  if (geminiKey && asked) {
    try {
      const brief = notebook.projects.map((project) => ({
        name: project.name,
        intent: project.intent || "",
        links: notebook.links.filter((link) => link.project_id === project.id).slice(0, 6),
      }));
      plan = await planRecall(geminiKey, asked, brief);
    } catch {
      plan = { related: true, projects: [], queries: [] };
    }
  }
  if (plan.related === false) {
    return { memories: [], sources: [], projects: [], miss: true, warning: "" };
  }
  const namedIds = idsForNames(notebook, plan.projects);
  const range = timeRange(asked);
  const queries = [
    ...new Set([asked, text, ...(plan.queries || [])].map((item) => String(item || "").trim()).filter(Boolean)),
  ].slice(0, 4);
  const local = [];
  for (const item of queries) {
    local.push(...recallLocally(notebook, item, new Date(), { projectIds: namedIds, range }));
  }
  let remote = [];
  let warning = "";
  const apiKey = await getMem0ApiKey();
  if (apiKey) {
    const filters = searchFilters({
      userId: await getMem0UserId(),
      projectIds: namedIds.length ? namedIds : mentionedProjectIds(notebook, asked),
      range,
    });
    for (const item of queries) {
      try {
        const found = await searchMemories(apiKey, item, filters);
        remote.push(...found.results);
      } catch (error) {
        warning = errorMessage(error);
      }
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
    miss: memories.length === 0,
  };
}

function idsForNames(notebook, names) {
  const wanted = new Set((names || []).map((name) => String(name || "").trim().toLowerCase()).filter(Boolean));
  const ids = new Set();
  for (const project of notebook.projects) {
    if (!wanted.has(String(project.name || "").trim().toLowerCase())) continue;
    ids.add(project.id);
    for (const id of descendantIds(notebook, project.id)) ids.add(id);
  }
  return [...ids];
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
  if (projectName && !tab.pinned) await joinCategory(tab, projectName, new Set());
  const placed = await chrome.tabs.get(tab.id);
  await chrome.windows.update(placed.windowId, { focused: true });
  await chrome.tabs.update(placed.id, { active: true });
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

async function watchProject(title, intent) {
  const label = String(title || "").trim();
  if (!label) throw new Error("Name the project you are working on.");
  const notebook = await getNotebook();
  const filed = acceptTrail(
    notebook,
    { label, one_liner: String(intent || "").trim(), tab_ids: [], tab_notes: [] },
    [],
  );
  await saveNotebook(filed.notebook);
  await setActiveProjectId(filed.project.id);
  const memory = await remember(filed.memories);
  const name = filed.project.name;
  return {
    text: `Watching ${name}. Related tabs join that group, and links opened in it are remembered.`,
    watching: { id: filed.project.id, name },
    project: name,
    created: filed.created,
    filed: filed.created || filed.intentChanged,
    sources: [],
    warning: memory.warning || "",
  };
}

async function stopWatching() {
  await setActiveProjectId(null);
  return {
    text: "Stopped. New tabs will stay where they are.",
    stopped: true,
    watching: null,
    filed: false,
    sources: [],
  };
}

async function judgeTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (tab.status && tab.status !== "complete") return;
  if (!pageReady(tab)) return;
  const notebook = await getNotebook();
  const under = await tabOpenedUnder(tab, notebook);
  if (under) {
    if (seenTabUrl.get(tabId) === tab.url) return;
    try {
      await fileOpenedLink(tab, under);
      seenTabUrl.set(tabId, tab.url);
    } catch (error) {
      reportInternal(error, "new link");
    }
    return;
  }
  const activeId = await getActiveProjectId();
  if (!activeId) return;
  const project = notebook.projects.find((item) => item.id === activeId);
  if (!project) {
    await setActiveProjectId(null);
    return;
  }
  const decision = watchDecision({
    project,
    tab,
    links: notebook.links,
    seenUrl: seenTabUrl.get(tabId) || "",
  });
  if (decision === "wait") return;
  if (decision === "skip") {
    if (tab.url) seenTabUrl.set(tabId, tab.url);
    return;
  }
  if (await groupedElsewhere(tab, project.name)) {
    seenTabUrl.set(tabId, tab.url);
    return;
  }
  if (decision === "group") {
    seenTabUrl.set(tabId, tab.url);
    await groupTab(tab, project.name).catch((error) => reportInternal(error, "group tab"));
    return;
  }

  const apiKey = await getGeminiApiKey();
  if (!apiKey) return;
  const snapshot = await readTabSnapshot(tab).catch(() => ({
    title: tab.title,
    url: tab.url,
    excerpt: "",
  }));
  let fresh = tab;
  try {
    fresh = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (fresh.url !== tab.url) return;
  let related = false;
  try {
    const known = notebook.links.filter((link) => link.project_id === project.id);
    related = await tabBelongsToProject(apiKey, { ...project, links: known }, snapshot);
  } catch (error) {
    reportInternal(error, "related tab");
    return;
  }
  seenTabUrl.set(tabId, tab.url);
  if (!related) return;

  const current = await getNotebook();
  const still = current.projects.find((item) => item.id === project.id);
  if (!still) return;
  const filed = acceptTrail(
    current,
    { label: still.name, one_liner: "", tab_ids: [fresh.id], tab_notes: [] },
    [{ id: fresh.id, title: snapshot.title || fresh.title || fresh.url, url: fresh.url }],
  );
  if (filed.links.length > 0) {
    await saveNotebook(filed.notebook);
    await remember(filed.memories);
    notifyFiled(snapshot.title || fresh.title || fresh.url, still.name);
  }
  try {
    const live = await chrome.tabs.get(fresh.id);
    await groupTab(live, still.name);
  } catch (error) {
    reportInternal(error, "group tab");
  }
}

async function tabOpenedUnder(tab, notebook) {
  const groupTitle = await chromeGroupTitle(tab);
  let openerGroupTitle = "";
  if (!groupTitle && tab.openerTabId) {
    try {
      openerGroupTitle = await chromeGroupTitle(await chrome.tabs.get(tab.openerTabId));
    } catch {
      openerGroupTitle = "";
    }
  }
  return openedUnderProject(notebook, { groupTitle, openerGroupTitle });
}

async function chromeGroupTitle(tab) {
  if (!tab || tab.groupId == null || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return "";
  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    return group.title || "";
  } catch {
    return "";
  }
}

async function fileOpenedLink(tab, project) {
  const current = await getNotebook();
  const still = current.projects.find((item) => item.id === project.id);
  if (!still) return;
  const filed = acceptTrail(
    current,
    { label: still.name, one_liner: "", tab_ids: [tab.id], tab_notes: [] },
    [{ id: tab.id, title: tab.title || tab.url, url: tab.url }],
  );
  if (filed.links.length > 0) {
    await saveNotebook(filed.notebook);
    const memory = await remember(filed.memories);
    notifyFiled(tab.title || tab.url, still.name);
    if (memory.warning && !/Add a Mem0 key/.test(memory.warning)) {
      reportInternal(new Error(memory.warning), "memory");
    }
  }
  try {
    const live = await chrome.tabs.get(tab.id);
    await groupTab(live, still.name);
  } catch (error) {
    reportInternal(error, "group tab");
  }
}

async function groupedElsewhere(tab, title) {
  if (tab.groupId == null || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    return Boolean(group.title) && group.title !== title;
  } catch {
    return false;
  }
}

async function groupTab(tab, title) {
  await joinCategory(tab, title, new Set());
}

function notifyFiled(title, project) {
  chrome.runtime.sendMessage({ type: "tab-filed", title, project }).catch(() => {});
}

function reportInternal(error, where) {
  const message = errorMessage(error);
  if (/no tab with id|tab not found/i.test(message)) return;
  chrome.runtime
    .sendMessage({
      type: "internal-error",
      message,
      stack: error instanceof Error ? error.stack || "" : "",
      where: where || "",
    })
    .catch(() => {});
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
