import { LAST_CLUSTER_KEY } from "./lib/storage.js";

const groupButton = document.querySelector("#group");
const status = document.querySelector("#status");
const trails = document.querySelector("#trails");
const savedAt = document.querySelector("#saved-at");

document.querySelector("#options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

groupButton.addEventListener("click", async () => {
  groupButton.disabled = true;
  setStatus("Grouping tabs…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "cluster-tabs" });
    if (!response?.ok) {
      setStatus(response?.error || "Could not group tabs.");
      return;
    }
    render(response.result);
    const count = response.result.trails.length;
    setStatus(count === 1 ? "Grouped 1 trail." : `Grouped ${count} trails.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not group tabs.");
  } finally {
    groupButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[LAST_CLUSTER_KEY]) {
    render(changes[LAST_CLUSTER_KEY].newValue);
  }
});

const stored = await chrome.storage.local.get(LAST_CLUSTER_KEY);
render(stored[LAST_CLUSTER_KEY]);

function setStatus(text) {
  status.textContent = text;
}

function render(cluster) {
  trails.replaceChildren();
  if (!cluster?.trails?.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Group the tabs that are open right now.";
    trails.append(empty);
    savedAt.textContent = "";
    return;
  }

  const byId = new Map((cluster.tabs || []).map((tab) => [tab.id, tab]));
  for (const trail of cluster.trails) {
    trails.append(renderTrail(trail, byId));
  }
  savedAt.textContent = cluster.savedAt ? `Saved ${formatWhen(cluster.savedAt)}` : "";
}

function renderTrail(trail, byId) {
  const card = document.createElement("article");
  card.className = "card";

  const title = document.createElement("h2");
  title.textContent = trail.label || "Untitled";

  const line = document.createElement("p");
  line.className = "one-liner";
  line.textContent = trail.one_liner || "";

  const list = document.createElement("ul");
  list.className = "tabs";
  const notes = new Map((trail.tab_notes || []).map((note) => [note.tab_id, note.note]));
  for (const tabId of trail.tab_ids || []) {
    const tab = byId.get(tabId);
    if (!tab) continue;
    list.append(renderTab(tab, notes.get(tabId)));
  }

  card.append(title, line, list);
  return card;
}

function renderTab(tab, note) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab";

  if (tab.favIconUrl) {
    const icon = document.createElement("img");
    icon.alt = "";
    icon.src = tab.favIconUrl;
    icon.addEventListener("error", () => icon.remove());
    button.append(icon);
  }

  const copy = document.createElement("span");
  copy.className = "tab-copy";
  const label = document.createElement("span");
  label.className = "tab-title";
  label.textContent = tab.title || tab.url || "Untitled";
  copy.append(label);

  const host = hostLabel(tab.url);
  if (host) {
    const hostLine = document.createElement("span");
    hostLine.className = "tab-host";
    hostLine.textContent = host;
    copy.append(hostLine);
  }
  if (note) {
    const noteLine = document.createElement("span");
    noteLine.className = "note";
    noteLine.textContent = note;
    copy.append(noteLine);
  }

  button.append(copy);
  button.addEventListener("click", () => focusTab(tab));
  item.append(button);
  return item;
}

async function focusTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    setStatus("That tab is closed. Group again to refresh the list.");
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
