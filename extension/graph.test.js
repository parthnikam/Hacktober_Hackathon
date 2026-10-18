import assert from "node:assert/strict";
import { createPreview } from "./lib/preview.js";
import { graphModel } from "./lib/graph-model.js";

const model = graphModel(createPreview());
assert.equal(model.nodes.length, 12);
assert.ok(model.edges.some((edge) => edge.kind === "parent" && edge.source === "prj_krowdkraft" && edge.target === "prj_mem0"));
const parent = model.nodes.find((node) => node.id === "prj_krowdkraft");
const child = model.nodes.find((node) => node.id === "prj_mem0");
assert.equal(child.kind, "child");
assert.equal(child.color, parent.color);
assert.equal(model.nodes.filter((node) => node.kind === "link").length, 7);
assert.equal(model.nodes.some((node) => node.kind === "suggestion" && node.label === "Voice commands"), true);

const shared = graphModel({
  projects: [
    { id: "a", name: "A", links: [{ title: "Plan", url: "https://example.com/plan#1", project_id: "a" }] },
    { id: "b", name: "B", links: [{ title: "Plan again", url: "https://example.com/plan", project_id: "b" }] },
  ],
});
assert.equal(shared.nodes.filter((node) => node.kind === "link").length, 1);
assert.equal(shared.edges.filter((edge) => edge.kind === "link").length, 2);

const duplicated = graphModel({
  projects: [
    {
      id: "a",
      name: "A",
      links: [
        { title: "Plan", url: "https://example.com/plan#1", project_id: "a", saved_at: "2026-10-01T00:00:00.000Z" },
        { title: "Plan 2", url: "https://example.com/plan", project_id: "a", saved_at: "2026-10-02T00:00:00.000Z" },
      ],
    },
  ],
});
assert.equal(duplicated.nodes.filter((node) => node.kind === "link").length, 1);
assert.equal(duplicated.nodes.find((node) => node.kind === "link").label, "Plan 2");
assert.deepEqual(graphModel({}), { nodes: [], edges: [] });

console.log("graph checks passed");
