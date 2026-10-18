import { mountErrorBox } from "./lib/errors.js";
import { dedupeLinks } from "./lib/groups.js";
import { directTitle, isQuestion, isStopCommand } from "./lib/watch.js";
import { graphModel } from "./lib/graph-model.js";
import { fillGraphDetail, mountGraph } from "./lib/graph-view.js";
import { toView } from "./lib/notebook.js";
import {
  acceptSuggestion,
  childProjects,
  createPreview,
  moveLink,
  projectPath,
  removeProject,
  renameProject,
  topLevelProjects,
} from "./lib/preview.js";

const viewRoot = document.querySelector("#view");
const status = document.querySelector("#status");
const source = document.querySelector("#source");
const viewButtons = [...document.querySelectorAll(".views button")];

const VIEWS = new Set(["projects", "timeline", "active", "graph"]);
const requested = new URLSearchParams(location.search).get("view");
const ui = {
  live: Boolean(globalThis.chrome?.runtime?.id),
  view: VIEWS.has(requested) ? requested : "projects",
  movingLinkId: null,
  renamingId: null,
  confirmingRemoveId: null,
  busy: false,
  answer: null,
  graph: null,
  watching: null,
  state: createPreview(),
};

document.querySelector("#options").addEventListener("click", () => {
  if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
});

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    ui.view = button.dataset.view;
    ui.movingLinkId = null;
    ui.renamingId = null;
    ui.confirmingRemoveId = null;
    render();
  });
}

document.querySelector("#ask").addEventListener("submit", (event) => {
  event.preventDefault();
  ask(document.querySelector("#question").value);
});

let loadTick = 0;
const showError = mountErrorBox(document.querySelector("#errors"));

function failStatus(response, fallback) {
  const message = response?.error || fallback;
  setStatus(message);
  showError(message, response?.stack || "");
}

if (ui.live) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "internal-error") {
      showError(message.message, message.stack, message.where);
      return;
    }
    if (message?.type !== "tab-filed") return;
    setStatus(`Added ${message.title} to ${message.project}.`);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes.notebook && !changes.activeProjectId) return;
    if (ui.renamingId || ui.confirmingRemoveId) return;
    loadLive();
  });
  loadLive();
} else {
  render();
}

function setStatus(text) {
  status.textContent = text;
}

function render() {
  ui.graph?.destroy();
  ui.graph = null;
  document.body.classList.remove("graph-open");
  for (const button of viewButtons) {
    button.setAttribute("aria-selected", String(button.dataset.view === ui.view));
  }
  document.querySelector("#ask").hidden = ui.view !== "projects";
  paintWatching();
  viewRoot.replaceChildren();
  if (ui.view === "projects" && ui.answer) viewRoot.append(renderAnswer(ui.answer));
  if (ui.view === "projects") renderProjects();
  else if (ui.view === "timeline") renderTimeline();
  else if (ui.view === "graph") renderGraph();
  else renderActive();
}

async function loadLive() {
  const tick = ++loadTick;
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (tick !== loadTick) return;
  if (!response?.ok) {
    failStatus(response, "Could not load the notebook.");
    return;
  }
  ui.state = toView(response.result.notebook, response.result.cluster, response.result.tabs);
  ui.watching = response.result.activeProject || null;
  if (source) source.textContent = "Saved on this computer";
  render();
}

function paintWatching() {
  const host = document.querySelector("#watching");
  host.replaceChildren();
  if (!ui.watching?.name) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const name = document.createElement("strong");
  name.textContent = ui.watching.name;
  host.append("Watching ", name, ". Related tabs join this group. ");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "text";
  stop.textContent = "Stop";
  stop.addEventListener("click", () => stopWatching());
  host.append(stop);
}

async function stopWatching() {
  if (!ui.live) {
    ui.watching = null;
    ui.answer = { text: "Stopped. New tabs will stay where they are.", sources: [] };
    ui.view = "projects";
    setStatus("Sample. Watching is off.");
    render();
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "clear-working-project" });
  if (!response?.ok) {
    failStatus(response, "Could not stop.");
    return;
  }
  ui.answer = { text: response.result.text, sources: [] };
  ui.view = "projects";
  setStatus(response.result.text);
  await loadLive();
}

async function ask(question) {
  const text = String(question || "").trim();
  if (!text) {
    setStatus("Type a question first.");
    return;
  }
  if (!ui.live) {
    if (isStopCommand(text)) {
      await stopWatching();
      return;
    }
    const title = !isQuestion(text) ? directTitle(text) : "";
    if (title) {
      ui.watching = { id: "preview", name: title };
      ui.answer = { text: `Watching ${title}. Related tabs join that group, and links opened in it are remembered.`, sources: [] };
      ui.view = "projects";
      document.querySelector("#question").value = "";
      setStatus("Sample. This page cannot group Chrome tabs.");
      render();
      return;
    }
    ui.answer = sampleAnswer(text);
    ui.view = "projects";
    setStatus("Sample answer from this page.");
    render();
    return;
  }
  setStatus("Thinking…");
  const response = await chrome.runtime.sendMessage({ type: "ask-memory", question: text });
  if (!response?.ok) {
    failStatus(response, "Could not answer that.");
    return;
  }
  ui.answer = response.result;
  ui.view = "projects";
  if (response.result.error) showError(response.result.error, response.result.stack || "", "ask");
  if (response.result.watching || response.result.stopped) {
    document.querySelector("#question").value = "";
    setStatus(response.result.warning || response.result.text);
    await loadLive();
    return;
  }
  const filed = response.result.filed ? "Filed into the project. " : "";
  setStatus(`${filed}${response.result.warning || "Answered from what you filed."}`.trim());
  if (response.result.filed) await loadLive();
  else render();
}

function sampleAnswer(question) {
  const words = String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  const links = ui.state.projects.flatMap((project) =>
    (project.links || []).map((link) => ({ title: link.title, url: link.url, project: project.name })),
  );
  const hits = links.filter((link) => {
    const hay = `${link.title} ${link.project} ${link.url}`.toLowerCase();
    return words.some((word) => hay.includes(word));
  });
  const shown = hits.slice(0, 6);
  const names = [...new Set(shown.map((link) => link.project))];
  return {
    text: shown.length
      ? `In ${names.join(" and ")}, you saved ${shown.map((link) => link.title).join(", ")}.`
      : "Nothing in the sample notebook matches that.",
    sources: shown.map((link) => ({ title: link.title, url: link.url })),
    projects: names,
  };
}

function renderAnswer(answer) {
  const card = document.createElement("article");
  card.className = "card";
  const title = document.createElement("h2");
  title.textContent = "Answer";
  const body = document.createElement("p");
  body.className = "answer";
  body.textContent = answer.text;
  card.append(title, body);
  const sources = (answer.sources || []).filter((source) => source?.url);
  if (sources.length) {
    const row = document.createElement("div");
    row.className = "sources";
    for (const source of sources) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "source";
      appendFavicon(chip, source);
      const label = document.createElement("span");
      label.className = "tab-title";
      label.textContent = source.title || source.url;
      label.title = source.title || source.url || "";
      chip.append(label);
      chip.addEventListener("click", () => openSavedLink(source));
      row.append(chip);
    }
    card.append(row);
  }
  return card;
}

function renderProjects() {
  viewRoot.append(renderGroupButton());
  viewRoot.append(sectionLabel("Suggestions"));
  if (ui.state.suggestions.length === 0) {
    viewRoot.append(empty("No suggestions. Group the active tabs to make one."));
  }
  for (const suggestion of ui.state.suggestions) {
    viewRoot.append(renderSuggestion(suggestion));
  }
  viewRoot.append(sectionLabel("Filed"));
  for (const project of topLevelProjects(ui.state)) {
    viewRoot.append(renderProject(project));
  }
}

function renderSuggestion(suggestion) {
  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("h2");
  title.textContent = suggestion.label;

  const line = document.createElement("p");
  line.className = "one-liner";
  line.textContent = suggestion.one_liner;

  const list = document.createElement("ul");
  list.className = "tabs";
  for (const tab of suggestion.tabs) {
    list.append(renderLinkRow(tab, { movable: false }));
  }

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary";
  accept.textContent = "Accept";
  accept.addEventListener("click", () => {
    if (ui.live) {
      fileSuggestion(suggestion);
      return;
    }
    ui.state = acceptSuggestion(ui.state, suggestion.id);
    setStatus(`Filed “${suggestion.label}” as a project.`);
    render();
  });

  card.append(title, line, list, accept);
  return card;
}

function renderProject(project) {
  const card = document.createElement("article");
  card.className = "card";
  card.append(projectBody(project));
  for (const child of childProjects(ui.state, project.id)) {
    const nested = document.createElement("div");
    nested.className = "subproject";
    nested.append(projectBody(child));
    card.append(nested);
  }
  return card;
}

function projectBody(project) {
  const links = dedupeLinks(project.links || []);
  const wrap = document.createElement("div");
  const head = document.createElement("div");
  head.className = "project-head";
  const title = document.createElement("h2");
  if (ui.renamingId === project.id) title.append(renameField(project));
  else {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "project-open";
    open.textContent = project.name;
    open.addEventListener("click", () => openFiledProject({ ...project, links }));
    title.append(open);
  }
  head.append(title);
  if (project.intent) head.append(infoMark(project.intent));
  head.append(projectActions(project));
  const count = document.createElement("p");
  count.className = "meta";
  const total = links.length;
  count.textContent = total === 1 ? "1 link" : `${total} links`;
  const list = document.createElement("ul");
  list.className = "tabs";
  for (const link of links) {
    list.append(renderLinkRow(link, { movable: true, projectId: project.id, openable: true }));
  }
  wrap.append(head, count, list);
  return wrap;
}

function renameField(project) {
  const form = document.createElement("form");
  form.className = "project-rename";
  const input = document.createElement("input");
  input.type = "text";
  input.value = project.name;
  input.setAttribute("aria-label", "Project name");
  form.append(input);
  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    ui.renamingId = null;
    render();
  };
  const finish = (value) => {
    if (done) return;
    done = true;
    const next = String(value || "").trim();
    if (!next || next === project.name) {
      ui.renamingId = null;
      render();
      return;
    }
    commitRename(project, next);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    finish(input.value);
  });
  input.addEventListener("blur", () => finish(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancel();
  });
  queueMicrotask(() => {
    if (ui.renamingId !== project.id) return;
    input.focus();
    input.select();
  });
  return form;
}

function projectActions(project) {
  const actions = document.createElement("div");
  actions.className = "project-actions";
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "text";
  rename.textContent = "Rename";
  rename.addEventListener("click", () => {
    ui.renamingId = project.id;
    ui.confirmingRemoveId = null;
    render();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text";
  const confirming = ui.confirmingRemoveId === project.id;
  remove.textContent = confirming ? "Delete" : "Remove";
  if (confirming) remove.classList.add("danger");
  remove.addEventListener("click", () => {
    if (ui.confirmingRemoveId !== project.id) {
      ui.confirmingRemoveId = project.id;
      ui.renamingId = null;
      render();
      return;
    }
    removeFiledProject(project);
  });
  actions.append(rename, remove);
  return actions;
}

function infoMark(text) {
  const info = document.createElement("span");
  info.className = "info";
  const mark = document.createElement("button");
  mark.type = "button";
  mark.className = "info-mark";
  mark.textContent = "i";
  mark.setAttribute("aria-label", "Project description");
  const tip = document.createElement("span");
  tip.className = "info-tip";
  tip.setAttribute("role", "tooltip");
  tip.textContent = text;
  info.append(mark, tip);
  return info;
}

function renderLinkRow(link, { movable, projectId, openable }) {
  const item = document.createElement("li");
  const line = document.createElement("div");
  line.className = "tab-line";
  const row = document.createElement(openable ? "button" : "div");
  if (openable) row.type = "button";
  row.className = openable ? "tab" : "tab static";
  appendFavicon(row, link);

  const copy = document.createElement("span");
  copy.className = "tab-copy";
  const label = document.createElement("span");
  label.className = "tab-title";
  label.textContent = link.title;
  label.title = link.title || "";
  copy.append(label);
  row.append(copy);
  if (openable) row.addEventListener("click", () => openSavedLink(link, projectId));
  line.append(row);

  if (movable) {
    const move = document.createElement("button");
    move.type = "button";
    move.className = "text";
    move.textContent = ui.movingLinkId === link.id ? "Close" : "Move";
    move.addEventListener("click", () => {
      ui.movingLinkId = ui.movingLinkId === link.id ? null : link.id;
      render();
    });
    line.append(move);
  }

  item.append(line);
  if (movable && ui.movingLinkId === link.id) {
    item.append(renderMoveChoices(link.id, projectId));
  }
  return item;
}

function renderMoveChoices(linkId, projectId) {
  const row = document.createElement("div");
  row.className = "move-row";
  const others = ui.state.projects.filter((project) => project.id !== projectId);
  for (const project of others) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = projectPath(ui.state, project.id);
    button.addEventListener("click", () => {
      if (ui.live) {
        fileMove(linkId, project.id, projectPath(ui.state, project.id));
        return;
      }
      ui.state = moveLink(ui.state, linkId, project.id);
      ui.movingLinkId = null;
      setStatus(`Moved to ${projectPath(ui.state, project.id)}.`);
      render();
    });
    row.append(button);
  }
  return row;
}

function renderGraph() {
  document.body.classList.add("graph-open");
  const stage = document.createElement("div");
  stage.className = "graph-stage";
  const model = graphModel(ui.state);
  if (!model.nodes.length) {
    stage.append(empty("File a project and it will show up here."));
    viewRoot.append(stage);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  const find = document.createElement("input");
  find.type = "search";
  find.className = "graph-find";
  find.placeholder = "Find a project or link";
  find.setAttribute("aria-label", "Find in the graph");
  const hud = document.createElement("div");
  hud.className = "graph-hud";
  hud.append(find);
  const detail = document.createElement("div");
  detail.className = "graph-detail";
  detail.hidden = true;
  stage.append(canvas, hud, detail);
  const foot = document.createElement("div");
  foot.className = "graph-foot";
  const hint = document.createElement("p");
  hint.className = "meta";
  hint.textContent = "Drag to move. Scroll to zoom. Double-click a project to open it.";
  const large = document.createElement("button");
  large.type = "button";
  large.className = "text";
  large.textContent = "Open large";
  large.addEventListener("click", openLargeGraph);
  foot.append(hint, large);
  viewRoot.append(stage, foot);
  ui.graph = mountGraph(canvas, model, {
    getQuery: () => find.value,
    onSelect(node) {
      fillGraphDetail(detail, node, openGraphNode);
    },
    onOpen: openGraphNode,
  });
  find.addEventListener("input", () => ui.graph?.redraw());
}

function openLargeGraph() {
  if (ui.live) {
    chrome.tabs.create({ url: chrome.runtime.getURL("graph.html") });
    return;
  }
  window.open("graph.html", "_blank");
}

function openGraphNode(node) {
  if (!node) return;
  if (node.kind === "link") {
    openSavedLink({ title: node.label, url: node.url }, node.projectId);
    return;
  }
  if (node.kind === "suggestion") {
    setStatus(node.intent || node.label);
    return;
  }
  const project = ui.state.projects.find((item) => item.id === node.id);
  if (project) openFiledProject(project);
}

function renderTimeline() {
  const weeks = ui.state.timeline || [];
  if (!weeks.some((week) => week.entries?.length)) {
    viewRoot.append(empty("Nothing filed yet."));
    return;
  }
  const list = document.createElement("ul");
  list.className = "tabs bare";
  for (const week of weeks) {
    if (!week.entries?.length) continue;
    const separator = document.createElement("li");
    separator.className = "week";
    separator.textContent = week.label;
    list.append(separator);
    for (const entry of week.entries) {
      list.append(renderLinkRow(entry, { openable: true }));
    }
  }
  viewRoot.append(list);
}

function renderGroupButton() {
  const actions = document.createElement("div");
  actions.className = "actions";
  const group = document.createElement("button");
  group.type = "button";
  group.className = "primary";
  group.textContent = "Group my tabs";
  group.addEventListener("click", () => groupLiveTabs(group));
  actions.append(group);
  return actions;
}

function renderActive() {
  viewRoot.append(renderGroupButton());

  const list = document.createElement("ul");
  list.className = "tabs bare";
  for (const tab of ui.state.active) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    appendFavicon(button, tab);
    const copy = document.createElement("span");
    copy.className = "tab-copy";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    title.title = tab.title || "";
    copy.append(title);
    button.append(copy);
    button.addEventListener("click", () => {
      if (ui.live && Number.isInteger(tab.id)) {
        focusTab(tab.id);
        return;
      }
      setStatus("Sample tab. This row is not one of your open tabs.");
    });
    item.append(button);
    list.append(item);
  }
  viewRoot.append(list);
}

function sectionLabel(text) {
  const heading = document.createElement("h2");
  heading.className = "section-label";
  heading.textContent = text;
  return heading;
}

function empty(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "empty";
  paragraph.textContent = text;
  return paragraph;
}

async function fileSuggestion(suggestion) {
  if (ui.busy) return;
  ui.busy = true;
  setStatus(`Filing “${suggestion.label}”…`);
  const response = await chrome.runtime.sendMessage({ type: "accept-suggestion", key: suggestion.key });
  ui.busy = false;
  if (!response?.ok) {
    failStatus(response, "Could not file that suggestion.");
    return;
  }
  const name = response.result.project?.name || suggestion.label;
  const where = response.result.created ? `Filed “${name}”.` : `Filed into ${name}.`;
  setStatus(response.result.warning ? `${where} ${response.result.warning}` : where);
  ui.movingLinkId = null;
  await loadLive();
}

async function fileMove(linkId, projectId, path) {
  if (ui.busy) return;
  ui.busy = true;
  setStatus(`Moving to ${path}…`);
  const response = await chrome.runtime.sendMessage({
    type: "move-link",
    linkId,
    projectId,
  });
  ui.busy = false;
  ui.movingLinkId = null;
  if (!response?.ok) {
    failStatus(response, "Could not move that link.");
    render();
    return;
  }
  const line = response.result.collapsed ? `That page was already in ${path}.` : `Moved to ${path}.`;
  setStatus(response.result.warning ? `${line} ${response.result.warning}` : line);
  await loadLive();
}

async function commitRename(project, name) {
  ui.renamingId = null;
  if (!ui.live) {
    const result = renameProject(ui.state, project.id, name);
    if (result.error) {
      setStatus(result.error);
      render();
      return;
    }
    ui.state = result.state;
    setStatus(`Renamed to ${name}.`);
    render();
    return;
  }
  setStatus(`Renaming ${project.name}…`);
  const response = await chrome.runtime.sendMessage({ type: "rename-project", projectId: project.id, name });
  if (!response?.ok) {
    failStatus(response, "Could not rename that project.");
    render();
    return;
  }
  const warning = response.result.warning ? ` ${response.result.warning}` : "";
  setStatus(`Renamed to ${response.result.name}.${warning}`);
  await loadLive();
}

async function removeFiledProject(project) {
  ui.confirmingRemoveId = null;
  if (!ui.live) {
    ui.state = removeProject(ui.state, project.id);
    setStatus(`Removed ${project.name}.`);
    render();
    return;
  }
  setStatus(`Removing ${project.name}…`);
  const response = await chrome.runtime.sendMessage({ type: "delete-project", projectId: project.id });
  if (!response?.ok) {
    failStatus(response, "Could not remove that project.");
    render();
    return;
  }
  setStatus(`Removed ${project.name}.`);
  await loadLive();
}

async function groupLiveTabs(button) {
  if (ui.busy) return;
  if (!ui.live) {
    setStatus("Open the side panel in Chrome to group the tabs.");
    return;
  }
  ui.busy = true;
  button.disabled = true;
  setStatus("Grouping tabs…");
  const response = await chrome.runtime.sendMessage({ type: "group-tabs" });
  ui.busy = false;
  button.disabled = false;
  if (!response?.ok) {
    failStatus(response, "Could not group tabs.");
    return;
  }
  const names = response.result?.projects || [];
  const made = response.result?.chromeGroups || names.length;
  const warning = response.result?.warning ? ` ${response.result.warning}` : "";
  if (made === 0) {
    setStatus(`No open tabs could be grouped.${warning}`);
  } else {
    setStatus(`Grouped ${names.join(", ")} in Chrome.${warning}`);
  }
  await loadLive();
}

async function openFiledProject(project) {
  if (!project.links.length) {
    setStatus(`${project.name} has no links to open.`);
    return;
  }
  if (!ui.live) {
    setStatus(`Opening ${project.name}.`);
    return;
  }
  setStatus(`Opening ${project.name}…`);
  const response = await chrome.runtime.sendMessage({ type: "open-project", projectId: project.id });
  if (!response?.ok) failStatus(response, "Could not open that project.");
  else setStatus(`Opened ${project.name}.`);
}

async function openSavedLink(link, projectId) {
  const project = ui.state.projects.find((item) => item.id === projectId);
  if (!ui.live) {
    setStatus(`Opening ${link.title}.`);
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "open-link",
    url: link.url,
    projectName: project?.name || "",
  });
  if (!response?.ok) failStatus(response, "Could not open that link.");
}

async function focusTab(tabId) {
  const response = await chrome.runtime.sendMessage({ type: "focus-tab", tabId });
  if (!response?.ok) failStatus(response, "Could not open that tab.");
}

function appendFavicon(parent, item) {
  const src = faviconSrc(item?.url, item?.favIconUrl);
  if (!src) return;
  const icon = document.createElement("img");
  icon.alt = "";
  icon.src = src;
  icon.addEventListener("error", () => icon.remove());
  parent.append(icon);
}

function faviconSrc(url, favIconUrl) {
  if (favIconUrl) return favIconUrl;
  if (!url) return "";
  const id = globalThis.chrome?.runtime?.id;
  if (id) return `chrome-extension://${id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
  } catch {
    return "";
  }
}

