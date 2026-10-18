function samePage(left, right) {
  if (!left || !right) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  } catch {
    return left === right;
  }
}

export function projectGroups(notebook, tabs) {
  const buckets = new Map();
  for (const tab of tabs || []) {
    const link = (notebook?.links || []).find((item) => samePage(item.url, tab.url));
    if (!link) continue;
    const project = (notebook.projects || []).find((item) => item.id === link.project_id);
    if (!project) continue;
    const bucket = buckets.get(project.id) || { title: project.name || "Untitled", tabIds: [] };
    bucket.tabIds.push(tab.id);
    buckets.set(project.id, bucket);
  }
  return [...buckets.values()];
}

export function mergeTrailGroups(groups, trails) {
  const used = new Set(groups.flatMap((group) => group.tabIds));
  const next = groups.map((group) => ({ title: group.title, tabIds: [...group.tabIds] }));
  for (const trail of trails || []) {
    const title = String(trail?.label || "").trim() || "Untitled";
    const ids = [];
    for (const id of trail?.tab_ids || []) {
      const numeric = Number(id);
      if (!Number.isInteger(numeric) || used.has(numeric)) continue;
      used.add(numeric);
      ids.push(numeric);
    }
    if (ids.length === 0) continue;
    const existing = next.find((group) => group.title === title);
    if (existing) existing.tabIds.push(...ids);
    else next.push({ title, tabIds: ids });
  }
  return next;
}
