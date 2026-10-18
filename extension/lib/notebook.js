// Local project notebook. Mem0 stores the sentences; this record stores which link is in which project.

export const MEM0_APP_ID = "krowdkraft";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const QUESTION_SKIP = new Set([
  "what",
  "was",
  "were",
  "looking",
  "about",
  "last",
  "week",
  "today",
  "yesterday",
  "this",
  "month",
  "that",
  "with",
  "from",
  "have",
  "been",
  "does",
  "did",
  "how",
  "why",
  "when",
  "where",
  "which",
  "project",
  "working",
  "open",
  "tabs",
  "just",
  "into",
  "your",
  "page",
  "pages",
]);

export function emptyNotebook() {
  return { projects: [], links: [] };
}

export function normalizeNotebook(value) {
  if (!value || typeof value !== "object") return emptyNotebook();
  return {
    projects: Array.isArray(value.projects) ? value.projects.filter((item) => item && item.id) : [],
    links: Array.isArray(value.links) ? value.links.filter((item) => item && item.id) : [],
  };
}

export function projectPath(notebook, projectId) {
  const names = [];
  let current = notebook.projects.find((project) => project.id === projectId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = notebook.projects.find((project) => project.id === current.parent_id);
  }
  return names.join(" / ");
}

export function topLevelProjects(notebook) {
  return notebook.projects.filter((project) => !project.parent_id);
}

export function childProjects(notebook, parentId) {
  return notebook.projects.filter((project) => project.parent_id === parentId);
}

export function descendantIds(notebook, projectId) {
  const ids = [];
  const queue = [projectId];
  while (queue.length) {
    const current = queue.shift();
    for (const project of notebook.projects) {
      if (project.parent_id !== current || ids.includes(project.id)) continue;
      ids.push(project.id);
      queue.push(project.id);
    }
  }
  return ids;
}

export function dayStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function projectSentence(path, intent) {
  const line = String(intent || "").trim();
  if (!line) return `The user has a project named ${path}.`;
  return `The user has a project named ${path}. Intent: ${line}`;
}

export function intentSentence(path, intent, savedAt) {
  return `On ${dayStamp(savedAt)} the user's intent in project ${path} was ${String(intent || "").trim()}`;
}

export function linkSentence(path, link, savedAt) {
  const because = String(link.note || "").trim();
  const reason = because ? ` because ${because}` : "";
  return `On ${dayStamp(savedAt)}, in project ${path}, the user saved ${link.title} (${link.url})${reason}.`;
}

function slug(name) {
  const cleaned = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return cleaned || "item";
}

function uniqueId(notebook, prefix, name) {
  const taken = new Set([
    ...notebook.projects.map((project) => project.id),
    ...notebook.links.map((link) => link.id),
  ]);
  const base = `${prefix}_${slug(name)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function memoryRecord(kind, project, sentence, url, savedAt) {
  const when = new Date(savedAt);
  return {
    kind,
    sentence,
    timestamp: Math.floor(when.getTime() / 1000),
    metadata: {
      kind,
      project_id: project.id,
      project_name: project.name,
      parent_project_id: project.parent_id || "",
      url: url || "",
      saved_at: dayStamp(when),
    },
  };
}

export function acceptTrail(notebook, trail, tabs, options = {}) {
  const now = options.now || new Date().toISOString();
  const label = String(trail?.label || "").trim() || "Untitled";
  const intent = String(trail?.one_liner || "").trim();
  const notes = new Map(
    (trail?.tab_notes || []).map((note) => [Number(note?.tab_id), String(note?.note || "").trim()]),
  );
  const pages = [];
  for (const id of trail?.tab_ids || []) {
    const tab = (tabs || []).find((item) => item.id === id);
    const url = String(tab?.url || "").trim();
    if (!url) continue;
    pages.push({
      title: String(tab?.title || "").trim() || "Untitled",
      url,
      note: notes.get(Number(id)) || "",
      tab_id: id,
    });
  }

  let project = notebook.projects.find((item) => item.name.toLowerCase() === label.toLowerCase());
  let projects = notebook.projects;
  let created = false;
  let intentChanged = false;
  if (!project) {
    project = {
      id: uniqueId(notebook, "prj", label),
      name: label,
      parent_id: options.parentId || null,
      intent,
      created_at: now,
      updated_at: now,
    };
    projects = [...projects, project];
    created = true;
    intentChanged = Boolean(intent);
  } else if (intent && intent !== project.intent) {
    project = { ...project, intent, updated_at: now };
    projects = projects.map((item) => (item.id === project.id ? project : item));
    intentChanged = true;
  }

  const filed = [];
  let links = notebook.links;
  for (const page of pages) {
    const already = links.some((link) => link.project_id === project.id && link.url === page.url);
    if (already) continue;
    const link = {
      id: uniqueId({ projects, links }, "lnk", page.title),
      project_id: project.id,
      url: page.url,
      title: page.title,
      note: page.note,
      tab_id: page.tab_id ?? null,
      saved_at: now,
    };
    filed.push(link);
    links = [...links, link];
  }

  const next = { projects, links };
  const path = projectPath(next, project.id);
  const memories = [];
  if (created) memories.push(memoryRecord("project", project, projectSentence(path, project.intent), "", now));
  if (intentChanged) memories.push(memoryRecord("intent", project, intentSentence(path, project.intent, now), "", now));
  for (const link of filed) {
    memories.push(memoryRecord("link", project, linkSentence(path, link, now), link.url, now));
  }

  return {
    notebook: next,
    project,
    created,
    intentChanged,
    links: filed,
    memories,
  };
}

export function moveLink(notebook, linkId, projectId, options = {}) {
  const link = notebook.links.find((item) => item.id === linkId);
  const target = notebook.projects.find((project) => project.id === projectId);
  if (!link || !target || link.project_id === projectId) {
    return { notebook, moved: false, memories: [] };
  }
  const now = options.now || new Date().toISOString();
  const nextLink = { ...link, project_id: projectId, saved_at: now };
  const next = {
    projects: notebook.projects,
    links: notebook.links.map((item) => (item.id === linkId ? nextLink : item)),
  };
  const path = projectPath(next, projectId);
  return {
    notebook: next,
    moved: true,
    link: nextLink,
    memories: [memoryRecord("link", target, linkSentence(path, nextLink, now), nextLink.url, now)],
  };
}

export function deleteProject(notebook, projectId) {
  const drop = new Set([projectId, ...descendantIds(notebook, projectId)]);
  return {
    projects: notebook.projects.filter((project) => !drop.has(project.id)),
    links: notebook.links.filter((link) => !drop.has(link.project_id)),
  };
}

function trailKey(trail) {
  const ids = [...(trail?.tab_ids || [])].map(Number).sort((a, b) => a - b);
  return `${String(trail?.label || "").trim()}::${ids.join(",")}`;
}

export function suggestionsFromCluster(cluster) {
  return (cluster?.trails || []).map((trail, index) => ({
    id: `sug_${index}`,
    key: trailKey(trail),
    label: trail.label,
    one_liner: trail.one_liner,
    tabs: (trail.tab_ids || []).map((tabId) => {
      const tab = (cluster.tabs || []).find((item) => item.id === tabId);
      const note = (trail.tab_notes || []).find((item) => Number(item.tab_id) === Number(tabId))?.note || "";
      return {
        id: tabId,
        title: tab?.title || "Untitled",
        url: tab?.url || "",
        favIconUrl: tab?.favIconUrl || "",
        note,
        tab_id: tabId,
      };
    }),
  }));
}

export function withoutTrail(cluster, key) {
  if (!cluster?.trails) return cluster;
  return {
    ...cluster,
    trails: cluster.trails.filter((trail) => trailKey(trail) !== key),
  };
}

export function mentionedProjectIds(notebook, question) {
  const text = String(question || "").toLowerCase();
  const matches = notebook.projects.filter((project) => {
    const name = String(project.name || "").trim().toLowerCase();
    return name.length >= 2 && text.includes(name);
  });
  const ids = new Set();
  for (const project of matches) {
    ids.add(project.id);
    for (const id of descendantIds(notebook, project.id)) ids.add(id);
  }
  return [...ids];
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

export function timeRange(question, now = new Date()) {
  const text = String(question || "").toLowerCase();
  const today = startOfDay(now);
  if (/\btoday\b/.test(text)) {
    return { gte: today.toISOString(), lt: addDays(today, 1).toISOString() };
  }
  if (/\byesterday\b/.test(text)) {
    return { gte: addDays(today, -1).toISOString(), lt: today.toISOString() };
  }
  if (/\blast week\b/.test(text)) {
    return { gte: addDays(today, -7).toISOString(), lt: today.toISOString() };
  }
  if (/\bthis week\b/.test(text)) {
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    return { gte: monday.toISOString(), lt: addDays(monday, 7).toISOString() };
  }
  if (/\blast month\b/.test(text)) {
    return {
      gte: new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString(),
      lt: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
    };
  }
  if (/\bthis month\b/.test(text)) {
    return {
      gte: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
      lt: new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString(),
    };
  }
  for (let index = 0; index < MONTHS.length; index += 1) {
    const match = text.match(new RegExp(`\\b${MONTHS[index]}\\b(?:\\s+(\\d{4}))?`));
    if (!match) continue;
    const year = match[1] ? Number(match[1]) : today.getFullYear();
    return {
      gte: new Date(year, index, 1).toISOString(),
      lt: new Date(year, index + 1, 1).toISOString(),
    };
  }
  return null;
}

export function searchFilters({ userId, projectIds, range }) {
  const and = [{ user_id: userId }, { app_id: MEM0_APP_ID }];
  if (range) and.push({ timestamp: { gte: range.gte, lt: range.lt } });
  if (projectIds?.length === 1) {
    and.push({ metadata: { project_id: projectIds[0] } });
  } else if (projectIds?.length > 1) {
    and.push({ OR: projectIds.map((id) => ({ metadata: { project_id: id } })) });
  }
  return { AND: and };
}

function within(savedAt, range) {
  const time = new Date(savedAt).getTime();
  return time >= new Date(range.gte).getTime() && time < new Date(range.lt).getTime();
}

export function recallLocally(notebook, question, now = new Date()) {
  const range = timeRange(question, now);
  const mentioned = mentionedProjectIds(notebook, question);
  const words = String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !QUESTION_SKIP.has(word));
  return notebook.links
    .filter((link) => {
      if (mentioned.length && !mentioned.includes(link.project_id)) return false;
      if (range && !within(link.saved_at, range)) return false;
      if (words.length === 0) return true;
      const project = notebook.projects.find((item) => item.id === link.project_id);
      const hay = `${link.title} ${link.note} ${link.url} ${project?.name || ""} ${project?.intent || ""}`.toLowerCase();
      return words.some((word) => hay.includes(word));
    })
    .map((link) => {
      const project = notebook.projects.find((item) => item.id === link.project_id);
      const path = projectPath(notebook, project.id);
      return {
        memory: linkSentence(path, link, link.saved_at),
        metadata: {
          project_name: project.name,
          project_id: project.id,
          kind: "link",
        },
      };
    });
}

export function toView(notebook, cluster, activeTabs, now = new Date()) {
  return {
    projects: notebook.projects.map((project) => ({
      ...project,
      links: notebook.links.filter((link) => link.project_id === project.id),
    })),
    suggestions: suggestionsFromCluster(cluster),
    timeline: timelineBuckets(notebook, now),
    active: (activeTabs || []).map((tab) => ({
      ...tab,
      project_id: notebook.links.find((link) => link.url && link.url === tab.url)?.project_id || null,
    })),
  };
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timelineBuckets(notebook, now = new Date()) {
  const today = startOfDay(now);
  const thisMonday = addDays(today, -((today.getDay() + 6) % 7));
  const lastMonday = addDays(thisMonday, -7);
  const buckets = [
    { label: "This week", start: thisMonday.getTime(), end: addDays(thisMonday, 7).getTime(), entries: [] },
    { label: "Last week", start: lastMonday.getTime(), end: thisMonday.getTime(), entries: [] },
    { label: "Earlier", start: Number.NEGATIVE_INFINITY, end: lastMonday.getTime(), entries: [] },
  ];
  const links = [...notebook.links].sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
  for (const link of links) {
    const time = new Date(link.saved_at).getTime();
    const bucket = buckets.find((item) => time >= item.start && time < item.end) || buckets[2];
    const project = notebook.projects.find((item) => item.id === link.project_id);
    bucket.entries.push({
      date: shortDate(link.saved_at),
      project: project ? projectPath(notebook, project.id) : "",
      title: link.title,
      url: link.url || "",
    });
  }
  return buckets.filter((bucket) => bucket.entries.length > 0).map(({ label, entries }) => ({ label, entries }));
}
