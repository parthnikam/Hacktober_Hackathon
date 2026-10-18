import { dedupeLinks, pageKey } from "./groups.js";

const PALETTE = ["#2f6f5e", "#3c6e91", "#8a5a2a", "#6e4c86", "#8d4548", "#3e6b38", "#2c6a72", "#7a5730"];

function rootId(project, byProject) {
  const seen = new Set();
  let current = project;
  while (current?.parent_id && byProject.has(current.parent_id) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byProject.get(current.parent_id);
  }
  return current?.id || project.id;
}

export function graphModel(state) {
  const nodes = [];
  const edges = [];
  const byId = new Map();
  const linkByPage = new Map();
  const projects = (state?.projects || []).filter((project) => project?.id);

  function addNode(node) {
    const existing = byId.get(node.id);
    if (existing) return existing;
    byId.set(node.id, node);
    nodes.push(node);
    return node;
  }

  function addEdge(source, target, kind) {
    if (!source || !target || source === target || !byId.has(source) || !byId.has(target)) return;
    const id = `${kind}:${source}->${target}`;
    if (edges.some((edge) => edge.id === id)) return;
    edges.push({ id, source, target, kind });
  }

  const byProject = new Map(projects.map((project) => [project.id, project]));
  const roots = [];
  for (const project of projects) {
    const root = rootId(project, byProject);
    if (!roots.includes(root)) roots.push(root);
  }
  for (const project of projects) {
    const root = rootId(project, byProject);
    addNode({
      id: project.id,
      kind: project.parent_id && byProject.has(project.parent_id) ? "child" : "project",
      label: project.name || "Untitled",
      intent: project.intent || "",
      projectId: project.id,
      color: PALETTE[roots.indexOf(root) % PALETTE.length],
    });
  }
  for (const project of projects) {
    if (project.parent_id) addEdge(project.parent_id, project.id, "parent");
    const color = byId.get(project.id)?.color;
    for (const link of dedupeLinks(project.links || [])) {
      const key = pageKey(link.url);
      if (!key) continue;
      let node = linkByPage.get(key);
      if (!node) {
        node = addNode({
          id: `page:${key}`,
          kind: "link",
          label: link.title || key,
          url: link.url,
          projectId: project.id,
          color,
        });
        linkByPage.set(key, node);
      }
      addEdge(project.id, node.id, "link");
    }
  }

  for (const suggestion of state?.suggestions || []) {
    if (!suggestion?.id) continue;
    addNode({
      id: suggestion.id,
      kind: "suggestion",
      label: suggestion.label || "Suggestion",
      intent: suggestion.one_liner || "",
      projectId: "",
      color: "#8a8175",
    });
    for (const tab of suggestion.tabs || []) {
      const key = pageKey(tab.url);
      if (!key) continue;
      let node = linkByPage.get(key);
      if (!node) {
        node = addNode({
          id: `page:${key}`,
          kind: "link",
          label: tab.title || key,
          url: tab.url,
          projectId: suggestion.id,
          color: "#8a8175",
        });
        linkByPage.set(key, node);
      }
      addEdge(suggestion.id, node.id, "link");
    }
  }

  return { nodes, edges };
}
