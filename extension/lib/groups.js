export function pageKey(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value;
  }
}

export function samePage(left, right) {
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

export function dedupeLinks(links) {
  const kept = [];
  for (const link of links || []) {
    const projectId = link?.project_id || "";
    const index = kept.findIndex(
      (item) => (item?.project_id || "") === projectId && samePage(item?.url, link?.url),
    );
    if (index === -1) {
      kept.push(link);
      continue;
    }
    const previous = new Date(kept[index]?.saved_at || 0).getTime();
    const current = new Date(link?.saved_at || 0).getTime();
    if (current > previous) kept[index] = link;
  }
  return kept;
}

export function reopenPlan(links, openTabs) {
  const reuse = [];
  const create = [];
  const pinned = [];
  const claimed = new Set();
  const seen = [];
  for (const link of links || []) {
    const url = String(link?.url || "").trim();
    if (!url || seen.some((item) => samePage(item, url))) continue;
    seen.push(url);
    const match = (openTabs || []).find(
      (tab) => tab?.id != null && !claimed.has(tab.id) && samePage(tab.url, url),
    );
    if (!match) {
      create.push(url);
      continue;
    }
    claimed.add(match.id);
    const item = { id: match.id, windowId: match.windowId, url: match.url };
    if (match.pinned) pinned.push(item);
    else reuse.push(item);
  }
  return { reuse, create, pinned };
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
