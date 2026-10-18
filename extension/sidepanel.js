import { toView } from "./lib/notebook.js";
import {
  acceptSuggestion,
  childProjects,
  createPreview,
  moveLink,
  projectPath,
  topLevelProjects,
} from "./lib/preview.js";

const viewRoot = document.querySelector("#view");
const status = document.querySelector("#status");
const source = document.querySelector("#source");
const viewButtons = [...document.querySelectorAll(".views button")];

const VIEWS = new Set(["projects", "timeline", "active"]);
const requested = new URLSearchParams(location.search).get("view");
const ui = {
  live: Boolean(globalThis.chrome?.runtime?.id),
  view: VIEWS.has(requested) ? requested : "projects",
  movingLinkId: null,
  busy: false,
  answer: null,
  state: createPreview(),
};

document.querySelector("#options").addEventListener("click", () => {
  if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
});

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    ui.view = button.dataset.view;
    ui.movingLinkId = null;
    render();
  });
}

document.querySelector("#ask").addEventListener("submit", (event) => {
  event.preventDefault();
  ask(document.querySelector("#question").value);
});

if (ui.live) loadLive();
else render();

function setStatus(text) {
  status.textContent = text;
}

function render() {
  for (const button of viewButtons) {
    button.setAttribute("aria-selected", String(button.dataset.view === ui.view));
  }
  viewRoot.replaceChildren();
  if (ui.answer) viewRoot.append(renderAnswer(ui.answer));
  if (ui.view === "projects") renderProjects();
  else if (ui.view === "timeline") renderTimeline();
  else renderActive();
}

async function loadLive() {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not load the notebook.");
    return;
  }
  ui.state = toView(response.result.notebook, response.result.cluster, response.result.tabs);
  if (source) source.textContent = "Saved on this computer";
  render();
}

async function ask(question) {
  const text = String(question || "").trim();
  if (!text) {
    setStatus("Type a question first.");
    return;
  }
  if (!ui.live) {
    setStatus("Sample data stays in this preview. The extension asks Mem0.");
    return;
  }
  setStatus("Looking through what you filed…");
  const response = await chrome.runtime.sendMessage({ type: "ask-memory", question: text });
  if (!response?.ok) {
    setStatus(response?.error || "Could not answer that.");
    return;
  }
  ui.answer = response.result;
  ui.view = "projects";
  setStatus(response.result.warning || "Answered from what you filed.");
  render();
}

function renderAnswer(answer) {
  const card = document.createElement("article");
  card.className = "card";
  const title = document.createElement("h2");
  title.textContent = "Answer";
  const body = document.createElement("p");
  body.className = "one-liner";
  body.textContent = answer.text;
  card.append(title, body);
  if (answer.projects?.length) {
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `Projects: ${answer.projects.join(", ")}`;
    card.append(meta);
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
  const wrap = document.createElement("div");
  const head = document.createElement("div");
  head.className = "project-head";
  const title = document.createElement("h2");
  const open = document.createElement("button");
  open.type = "button";
  open.className = "project-open";
  open.textContent = project.name;
  open.addEventListener("click", () => openFiledProject(project));
  title.append(open);
  head.append(title);
  if (project.intent) head.append(infoMark(project.intent));
  const count = document.createElement("p");
  count.className = "meta";
  const total = project.links.length;
  count.textContent = total === 1 ? "1 link" : `${total} links`;
  const list = document.createElement("ul");
  list.className = "tabs";
  for (const link of project.links) {
    list.append(renderLinkRow(link, { movable: true, projectId: project.id, openable: true }));
  }
  wrap.append(head, count, list);
  return wrap;
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

function renderTimeline() {
  if (!ui.state.timeline.length) {
    viewRoot.append(empty("Nothing filed yet."));
    return;
  }
  for (const week of ui.state.timeline) {
    viewRoot.append(sectionLabel(week.label));
    const card = document.createElement("article");
    card.className = "card";
    const list = document.createElement("ul");
    list.className = "tabs";
    for (const entry of week.entries) {
      const item = document.createElement("li");
      const row = document.createElement("div");
      row.className = "tab static";
      appendFavicon(row, entry);
      const copy = document.createElement("span");
      copy.className = "tab-copy";
      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = entry.title;
      title.title = entry.title || "";
      copy.append(title);
      row.append(copy);
      item.append(row);
      list.append(item);
    }
    card.append(list);
    viewRoot.append(card);
  }
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
    setStatus(response?.error || "Could not file that suggestion.");
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
    setStatus(response?.error || "Could not move that link.");
    render();
    return;
  }
  setStatus(response.result.warning ? `Moved to ${path}. ${response.result.warning}` : `Moved to ${path}.`);
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
    setStatus(response?.error || "Could not group tabs.");
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
  if (!response?.ok) setStatus(response?.error || "Could not open that project.");
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
  if (!response?.ok) setStatus(response?.error || "Could not open that link.");
}

async function focusTab(tabId) {
  const response = await chrome.runtime.sendMessage({ type: "focus-tab", tabId });
  if (!response?.ok) setStatus(response?.error || "Could not open that tab.");
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

