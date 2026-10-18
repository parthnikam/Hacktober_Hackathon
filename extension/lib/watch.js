import { samePage } from "./groups.js";
import { shouldSkipUrl } from "./tabs.js";

const IDLE_TITLES = new Set(["", "new tab", "untitled", "about:blank"]);

export function isQuestion(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.includes("?")) return true;
  return /^(what|when|where|who|why|how|which|did|do|does|can|could|is|are|was|were|tell me|show me)\b/i.test(value);
}

export function isStopCommand(text) {
  const value = String(text || "")
    .trim()
    .replace(/[.!]+$/g, "");
  return /^(stop|stop watching|stop adding tabs|done|i'?m done|i am done|done with (this|the) project)$/i.test(value);
}

// Used only when Gemma is unavailable. Pulls the title out of "working on …" or "the project is …".
export function directTitle(text) {
  const value = String(text || "")
    .trim()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ");
  const lead = value.match(/^(?:(?:i am|i'm|im)\s+)?working on\s+(.+)$/i) || value.match(/^(?:the )?project is\s+(.+)$/i);
  if (!lead) return "";
  const title = lead[1].trim();
  if (!title || title.length > 48) return "";
  return title;
}

export function pageReady(tab) {
  if (!tab || tab.id == null || tab.pinned) return false;
  if (shouldSkipUrl(tab.url)) return false;
  const title = String(tab.title || "").trim().toLowerCase();
  return !IDLE_TITLES.has(title);
}

export function projectForGroupTitle(notebook, title) {
  const name = String(title || "").trim().toLowerCase();
  if (!name) return null;
  return notebook?.projects?.find((project) => String(project?.name || "").trim().toLowerCase() === name) || null;
}

export function openedUnderProject(notebook, { groupTitle, openerGroupTitle } = {}) {
  const own = projectForGroupTitle(notebook, groupTitle);
  if (own) return own;
  if (String(groupTitle || "").trim()) return null;
  return projectForGroupTitle(notebook, openerGroupTitle);
}

export function watchDecision({ project, tab, links, seenUrl }) {
  if (!project?.id || tab?.id == null) return "skip";
  if (tab.pinned) return "skip";
  const url = String(tab.url || "");
  if (shouldSkipUrl(url)) return "skip";
  if (seenUrl && seenUrl === url) return "skip";
  const title = String(tab.title || "").trim().toLowerCase();
  if (IDLE_TITLES.has(title)) return "wait";
  const pages = links || [];
  if (pages.some((link) => link.project_id === project.id && samePage(link.url, url))) return "group";
  if (pages.some((link) => link.project_id && link.project_id !== project.id && samePage(link.url, url))) return "skip";
  return "ask";
}
