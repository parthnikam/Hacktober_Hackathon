import { graphModel } from "./lib/graph-model.js";
import { fillGraphDetail, mountGraph } from "./lib/graph-view.js";
import { toView } from "./lib/notebook.js";
import { createPreview } from "./lib/preview.js";

const canvas = document.querySelector(".graph-canvas");
const find = document.querySelector("#find");
const detail = document.querySelector("#detail");
const status = document.querySelector("#status");
const source = document.querySelector("#source");
const live = Boolean(globalThis.chrome?.runtime?.id);

let state = createPreview();
let handle = null;

function projectName(node) {
  return state.projects.find((project) => project.id === node.projectId)?.name || "";
}

function openNode(node) {
  if (!node) return;
  if (node.kind === "suggestion") {
    status.textContent = node.intent || node.label;
    return;
  }
  if (!live) {
    status.textContent = `Opening ${node.label}.`;
    return;
  }
  const message =
    node.kind === "link"
      ? { type: "open-link", url: node.url, projectName: projectName(node) }
      : { type: "open-project", projectId: node.id };
  chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) status.textContent = response?.error || "Could not open that.";
    else status.textContent = `Opened ${node.label}.`;
  });
}

function paint() {
  handle?.destroy();
  handle = null;
  const model = graphModel(state);
  if (!model.nodes.length) {
    status.textContent = "File a project and it will show up here.";
    return;
  }
  handle = mountGraph(canvas, model, {
    getQuery: () => find.value,
    onSelect(node) {
      fillGraphDetail(detail, node, openNode);
    },
    onOpen: openNode,
  });
}

find.addEventListener("input", () => handle?.redraw());

if (live) {
  const response = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!response?.ok) {
    status.textContent = response?.error || "Could not load the notebook.";
  } else {
    state = toView(response.result.notebook, response.result.cluster, response.result.tabs);
    if (source) source.textContent = "Saved on this computer";
  }
}

paint();
