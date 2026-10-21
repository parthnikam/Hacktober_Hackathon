import { samePage } from "./groups.js";

const SEED = {
  projects: [
    {
      id: "prj_krowdkraft",
      name: "KrowdKraft",
      parent_id: null,
      intent: "File open tabs into projects so a closed page can still be found.",
      links: [
        {
          id: "lnk_plan",
          title: "Context for Humans plan",
          url: "https://github.com/example/krowdkraft/blob/main/plan.md",
          note: "Build order for the extension.",
        },
        {
          id: "lnk_groups",
          title: "Chrome tab groups",
          url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups",
          note: "Whether one click can name a group.",
        },
      ],
    },
    {
      id: "prj_mem0",
      name: "Mem0",
      parent_id: "prj_krowdkraft",
      intent: "Remember a trail after the tabs are closed.",
      links: [
        {
          id: "lnk_mem0",
          title: "mem0 docs",
          url: "https://docs.mem0.ai",
          note: "How add and search work.",
        },
      ],
    },
    {
      id: "prj_pasta",
      name: "Sunday pasta",
      parent_id: null,
      intent: "A dough recipe for this weekend.",
      links: [
        {
          id: "lnk_pasta",
          title: "Pasta dough",
          url: "https://example.com/pasta-dough",
          note: "Flour, eggs, and salt ratios.",
        },
      ],
    },
    {
      id: "prj_course",
      name: "Agents course",
      parent_id: null,
      intent: "Notes for a class, separate from the hackathon.",
      links: [
        {
          id: "lnk_mdn",
          title: "MDN tabs.group",
          url: "https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group",
          note: "Same API as KrowdKraft, kept here for the class.",
        },
      ],
    },
  ],
  suggestions: [
    {
      id: "sug_voice",
      projectId: "prj_voice",
      label: "Voice commands",
      one_liner: "A short spoken command should land in the same memory as a typed one.",
      tabs: [
        {
          title: "Sarvam speech to text",
          url: "https://docs.sarvam.ai/api-reference/speech-to-text/transcribe",
          note: "REST is enough for a clip under 30 seconds.",
        },
        {
          title: "MediaRecorder",
          url: "https://developer.mozilla.org/docs/Web/API/MediaRecorder",
          note: "How the mic button would capture the clip.",
        },
      ],
    },
  ],
  timeline: [
    {
      label: "This week",
      entries: [
        {
          date: "Oct 18",
          project: "KrowdKraft / Mem0",
          title: "mem0 docs",
          url: "https://docs.mem0.ai",
        },
        {
          date: "Oct 17",
          project: "KrowdKraft",
          title: "Chrome tab groups",
          url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups",
        },
      ],
    },
    {
      label: "Last week",
      entries: [
        {
          date: "Oct 11",
          project: "Sunday pasta",
          title: "Pasta dough",
          url: "https://example.com/pasta-dough",
        },
        {
          date: "Oct 9",
          project: "Agents course",
          title: "MDN tabs.group",
          url: "https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group",
        },
      ],
    },
  ],
  active: [
    {
      id: "tab_plan",
      title: "Context for Humans plan",
      url: "https://github.com/example/krowdkraft/blob/main/plan.md",
      project_id: "prj_krowdkraft",
    },
    {
      id: "tab_mem0",
      title: "mem0 docs",
      url: "https://docs.mem0.ai",
      project_id: "prj_mem0",
    },
    {
      id: "tab_pasta",
      title: "Pasta dough",
      url: "https://example.com/pasta-dough",
      project_id: "prj_pasta",
    },
    {
      id: "tab_gemini",
      title: "Gemini structured output",
      url: "https://ai.google.dev/gemini-api/docs/structured-output",
      project_id: null,
    },
    {
      id: "tab_github",
      title: "mem0 on GitHub",
      url: "https://github.com/mem0ai/mem0",
      project_id: null,
    },
  ],
};

export function createPreview() {
  return structuredClone(SEED);
}

export function projectPath(state, projectId) {
  const names = [];
  let current = state.projects.find((project) => project.id === projectId);
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = state.projects.find((project) => project.id === current.parent_id);
  }
  return names.join(" / ");
}

export function topLevelProjects(state) {
  return state.projects.filter((project) => !project.parent_id);
}

export function childProjects(state, parentId) {
  return state.projects.filter((project) => project.parent_id === parentId);
}

export function acceptSuggestion(state, suggestionId) {
  const suggestion = state.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return state;
  if (state.projects.some((project) => project.id === suggestion.projectId)) return state;
  const project = {
    id: suggestion.projectId,
    name: suggestion.label,
    parent_id: null,
    intent: suggestion.one_liner,
    links: suggestion.tabs.map((tab, index) => ({
      id: `${suggestion.projectId}_${index}`,
      title: tab.title,
      url: tab.url,
      note: tab.note,
    })),
  };
  return {
    ...state,
    suggestions: state.suggestions.filter((item) => item.id !== suggestionId),
    projects: [...state.projects, project],
  };
}

export function removeLink(state, linkId) {
  return {
    ...state,
    projects: (state.projects || []).map((project) => ({
      ...project,
      links: (project.links || []).filter((link) => link.id !== linkId),
    })),
  };
}

export function moveLink(state, linkId, projectId) {
  const current = state.projects.find((project) => project.links.some((link) => link.id === linkId));
  const target = state.projects.find((project) => project.id === projectId);
  if (!current || !target || current.id === projectId) return state;
  const link = current.links.find((item) => item.id === linkId);
  const duplicate = target.links.some((item) => samePage(item.url, link.url));
  return {
    ...state,
    projects: state.projects.map((project) => {
      if (project.id === current.id) {
        return { ...project, links: project.links.filter((item) => item.id !== linkId) };
      }
      if (project.id === projectId && !duplicate) {
        return { ...project, links: [...project.links, link] };
      }
      return project;
    }),
  };
}

export function renameProject(state, projectId, name) {
  const nextName = String(name || "").trim();
  if (!nextName) return { state, error: "Type a project name." };
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return { state, error: "That project is gone." };
  const clash = state.projects.some(
    (item) => item.id !== projectId && item.name.toLowerCase() === nextName.toLowerCase(),
  );
  if (clash) return { state, error: "A project already has that name." };
  if (project.name === nextName) return { state };
  const from = projectPath(state, projectId);
  const next = {
    ...state,
    projects: state.projects.map((item) => (item.id === projectId ? { ...item, name: nextName } : item)),
  };
  const to = projectPath(next, projectId);
  return { state: { ...next, timeline: retitleTimeline(state.timeline, from, to) } };
}

export function removeProject(state, projectId) {
  const drop = new Set([projectId, ...descendantIds(state, projectId)]);
  const paths = new Set([...drop].map((id) => projectPath(state, id)));
  return {
    ...state,
    projects: state.projects.filter((project) => !drop.has(project.id)),
    timeline: (state.timeline || [])
      .map((week) => ({
        ...week,
        entries: week.entries.filter((entry) => !paths.has(entry.project)),
      }))
      .filter((week) => week.entries.length),
  };
}

function descendantIds(state, projectId) {
  const ids = [];
  const queue = [projectId];
  while (queue.length) {
    const current = queue.shift();
    for (const project of state.projects) {
      if (project.parent_id !== current || ids.includes(project.id)) continue;
      ids.push(project.id);
      queue.push(project.id);
    }
  }
  return ids;
}

function retitleTimeline(timeline, from, to) {
  return (timeline || []).map((week) => ({
    ...week,
    entries: week.entries.map((entry) => {
      const project = entry.project || "";
      if (project === from || project.startsWith(`${from} / `)) {
        return { ...entry, project: to + project.slice(from.length) };
      }
      return entry;
    }),
  }));
}

export function suggestFromActive(state) {
  const unfiled = state.active.filter((tab) => !tab.project_id);
  if (unfiled.length === 0) {
    return { state, status: "Every sample tab is already in a project." };
  }
  if (state.suggestions.some((item) => item.id === "sug_active")) {
    return { state, status: "That suggestion is already under Projects." };
  }
  const suggestion = {
    id: "sug_active",
    projectId: "prj_open",
    label: "Open tabs",
    one_liner: "These open tabs are not filed under a project yet.",
    tabs: unfiled.map((tab) => ({
      title: tab.title,
      url: tab.url,
      note: "Suggested from the sample tabs that are open.",
    })),
  };
  return {
    state: { ...state, suggestions: [suggestion, ...state.suggestions] },
    status: "Sample suggestion added under Projects. These are not your open tabs.",
  };
}
