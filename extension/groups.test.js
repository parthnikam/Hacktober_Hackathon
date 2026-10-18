import assert from "node:assert/strict";
import { mergeTrailGroups, projectGroups } from "./lib/groups.js";

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

const filed = projectGroups(notebook, tabs);
assert.deepEqual(filed.find((group) => group.title === "KrowdKraft").tabIds, [1, 4]);
assert.deepEqual(filed.find((group) => group.title === "Sunday pasta").tabIds, [2]);

const merged = mergeTrailGroups(filed, [
  { label: "News", tab_ids: [3, 1] },
  { label: "KrowdKraft", tab_ids: [9] },
]);
assert.deepEqual(merged.find((group) => group.title === "News").tabIds, [3]);
assert.deepEqual(merged.find((group) => group.title === "KrowdKraft").tabIds, [1, 4, 9]);

console.log("group checks passed");
