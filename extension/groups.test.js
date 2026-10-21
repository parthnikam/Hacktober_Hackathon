import assert from "node:assert/strict";
import {
  categoryHome,
  dedupeLinks,
  gatherPlan,
  groupsAfterRemoval,
  isUntitledTitle,
  mergeTrailGroups,
  projectGroups,
  pullUntitled,
  reopenPlan,
} from "./lib/groups.js";
import { clusterWithoutUrl, moveLink, normalizeNotebook, removeLink, renameProject } from "./lib/notebook.js";

const notebook = {
  projects: [
    { id: "a", name: "KrowdKraft" },
    { id: "b", name: "Sunday pasta" },
  ],
  links: [
    { url: "https://github.com/example/krowdkraft", project_id: "a" },
    { url: "https://example.com/pasta#salt", project_id: "b" },
    { url: "https://docs.mem0.ai/", project_id: "a" },
  ],
};

const tabs = [
  { id: 1, url: "https://github.com/example/krowdkraft" },
  { id: 2, url: "https://example.com/pasta" },
  { id: 3, url: "https://news.example/" },
  { id: 4, url: "https://docs.mem0.ai/" },
];

assert.equal(isUntitledTitle(""), true);
assert.equal(isUntitledTitle("Untitled document - Google Docs"), true);
assert.equal(isUntitledTitle("Untitled Goose Game"), false);

const gathered = pullUntitled(projectGroups(notebook, tabs), [
  ...tabs.map((tab) => ({ ...tab, title: "Saved page" })),
  { id: 5, title: "Untitled document", url: "https://docs.google.com/document/d/1" },
  { id: 6, title: "", url: "https://example.com/blank" },
  { id: 7, title: "Recipe", url: "https://example.com/recipe" },
]);
assert.deepEqual(gathered.find((group) => group.title === "Untitled").tabIds, [5, 6]);
assert.equal(gathered.some((group) => group.tabIds.includes(7)), false);

const filed = projectGroups(notebook, tabs);
assert.deepEqual(filed.find((group) => group.title === "KrowdKraft").tabIds, [1, 4]);
assert.deepEqual(filed.find((group) => group.title === "Sunday pasta").tabIds, [2]);

const merged = mergeTrailGroups(filed, [
  { label: "News", tab_ids: [3, 1] },
  { label: "KrowdKraft", tab_ids: [9] },
]);
assert.deepEqual(merged.find((group) => group.title === "News").tabIds, [3]);
assert.deepEqual(merged.find((group) => group.title === "KrowdKraft").tabIds, [1, 4, 9]);

const scattered = [
  { id: 1, windowId: 1, index: 0 },
  { id: 2, windowId: 2, index: 1 },
  { id: 3, windowId: 1, index: 4 },
  { id: 4, windowId: 2, index: 0 },
];
assert.equal(categoryHome(scattered), 1);
assert.equal(categoryHome([{ id: 1, windowId: 2 }, { id: 2, windowId: 2 }, { id: 3, windowId: 1 }]), 2);
assert.equal(categoryHome(scattered, 8), 8);
const gatheredTabs = gatherPlan(scattered, 1);
assert.deepEqual(gatheredTabs.groupIds, [1, 3, 4, 2]);
assert.equal(gatheredTabs.index, 0);
assert.equal(gatherPlan([{ id: 9, windowId: 3, index: 2 }], 1).index, -1);

const kept = groupsAfterRemoval(
  [
    { title: "KrowdKraft", tabIds: [1] },
    { title: "Sunday pasta", tabIds: [2] },
    { title: "Untitled", tabIds: [3] },
  ],
  ["Sunday pasta", "  "],
);
assert.deepEqual(kept.map((group) => group.title), ["KrowdKraft", "Untitled"]);

const plan = reopenPlan(
  [
    { url: "https://github.com/example/krowdkraft" },
    { url: "https://example.com/pasta#salt" },
    { url: "https://example.com/pasta" },
    { url: "https://docs.mem0.ai/" },
    { url: "" },
  ],
  [
    { id: 4, url: "https://docs.mem0.ai/", windowId: 2, pinned: true },
    { id: 7, url: "https://github.com/example/krowdkraft", windowId: 1 },
  ],
);
assert.deepEqual(plan.reuse, [{ id: 7, windowId: 1, url: "https://github.com/example/krowdkraft" }]);
assert.deepEqual(plan.create, ["https://example.com/pasta#salt"]);
assert.deepEqual(plan.pinned, [{ id: 4, windowId: 2, url: "https://docs.mem0.ai/" }]);

const unique = dedupeLinks([
  { id: "1", project_id: "a", url: "https://example.com/plan#top", saved_at: "2026-10-01T00:00:00.000Z" },
  { id: "2", project_id: "a", url: "https://example.com/plan", saved_at: "2026-10-02T00:00:00.000Z" },
  { id: "3", project_id: "b", url: "https://example.com/plan", saved_at: "2026-10-02T00:00:00.000Z" },
]);
assert.deepEqual(unique.map((link) => link.id), ["2", "3"]);

const cleaned = normalizeNotebook({
  projects: [
    { id: "a", name: "KrowdKraft" },
    { id: "b", name: "Sunday pasta" },
  ],
  links: unique,
});
assert.equal(cleaned.links.length, 2);

const base = {
  projects: [
    { id: "a", name: "KrowdKraft", intent: "File tabs." },
    { id: "b", name: "Sunday pasta", intent: "Dinner." },
  ],
  links: [
    { id: "1", project_id: "a", url: "https://example.com/plan", title: "Plan", note: "" },
    { id: "9", project_id: "b", url: "https://example.com/plan#x", title: "Plan", note: "" },
    { id: "3", project_id: "b", url: "https://example.com/pasta", title: "Pasta", note: "" },
  ],
};
const dropped = removeLink(base, "3");
assert.equal(dropped.removed, true);
assert.equal(dropped.project.name, "Sunday pasta");
assert.equal(dropped.notebook.links.some((link) => link.id === "3"), false);
const cluster = clusterWithoutUrl(
  {
    trails: [{ label: "Sunday pasta", tab_ids: [3, 4], tab_notes: [{ tab_id: 3, note: "dough" }] }],
    tabs: [{ id: 3, url: "https://example.com/pasta" }, { id: 4, url: "https://example.com/sauce" }],
  },
  "https://example.com/pasta",
);
assert.deepEqual(cluster.trails[0].tab_ids, [4]);
assert.deepEqual(cluster.trails[0].tab_notes, []);

const moved = moveLink(base, "3", "a");
assert.equal(moved.moved, true);
assert.equal(moved.notebook.links.find((link) => link.id === "3").project_id, "a");
assert.equal(moved.memories.length, 1);
const collapsed = moveLink(moved.notebook, "9", "a");
assert.equal(collapsed.moved, true);
assert.equal(collapsed.memories.length, 0);
assert.equal(collapsed.notebook.links.some((link) => link.id === "9"), false);
assert.equal(collapsed.notebook.links.filter((link) => link.url.includes("plan")).length, 1);

const clash = renameProject(base, "b", "krowdkraft");
assert.match(clash.error, /already has that name/);
const renamed = renameProject(base, "b", "Weeknight pasta");
assert.equal(renamed.renamed, true);
assert.equal(renamed.project.name, "Weeknight pasta");
assert.match(renamed.memories[0].sentence, /Weeknight pasta/);

console.log("group checks passed");
