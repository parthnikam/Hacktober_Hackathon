import assert from "node:assert/strict";
import {
  acceptSuggestion,
  createPreview,
  moveLink,
  projectPath,
  removeLink,
  removeProject,
  renameProject,
  suggestFromActive,
} from "./lib/preview.js";

const start = createPreview();
assert.equal(projectPath(start, "prj_mem0"), "KrowdKraft / Mem0");

const filed = acceptSuggestion(start, "sug_voice");
assert.equal(filed.suggestions.length, 0);
assert.equal(filed.projects.at(-1).name, "Voice commands");
assert.equal(filed.projects.at(-1).links.length, 2);
assert.equal(acceptSuggestion(filed, "sug_voice"), filed);

const moved = moveLink(start, "lnk_mdn", "prj_krowdkraft");
const course = moved.projects.find((project) => project.id === "prj_course");
const hack = moved.projects.find((project) => project.id === "prj_krowdkraft");
assert.equal(course.links.some((link) => link.id === "lnk_mdn"), false);
assert.equal(hack.links.some((link) => link.id === "lnk_mdn"), true);
assert.equal(moveLink(start, "lnk_mdn", "prj_course"), start);
const without = removeLink(start, "lnk_mdn");
assert.equal(without.projects.find((project) => project.id === "prj_course").links.some((link) => link.id === "lnk_mdn"), false);

const duplicated = structuredClone(start);
duplicated.projects.find((project) => project.id === "prj_pasta").links.push({
  id: "lnk_plan_copy",
  title: "Plan copy",
  url: "https://github.com/example/krowdkraft/blob/main/plan.md",
});
const collapsed = moveLink(duplicated, "lnk_plan", "prj_pasta");
const pasta = collapsed.projects.find((project) => project.id === "prj_pasta");
const kraft = collapsed.projects.find((project) => project.id === "prj_krowdkraft");
assert.equal(kraft.links.some((link) => link.id === "lnk_plan"), false);
assert.equal(pasta.links.filter((link) => link.url.includes("plan.md")).length, 1);
assert.equal(pasta.links.some((link) => link.id === "lnk_plan_copy"), true);

const clash = renameProject(start, "prj_pasta", "agents course");
assert.match(clash.error, /already has that name/);
assert.equal(clash.state.projects.find((project) => project.id === "prj_pasta").name, "Sunday pasta");
const renamed = renameProject(start, "prj_pasta", "Weeknight pasta");
assert.equal(renamed.state.projects.find((project) => project.id === "prj_pasta").name, "Weeknight pasta");
assert.equal(renamed.state.timeline[1].entries[0].project, "Weeknight pasta");

const removed = removeProject(start, "prj_krowdkraft");
assert.equal(removed.projects.some((project) => project.id === "prj_krowdkraft" || project.id === "prj_mem0"), false);
assert.equal(removed.projects.some((project) => project.id === "prj_pasta"), true);
assert.equal(removed.timeline.some((week) => week.entries.some((entry) => entry.project.startsWith("KrowdKraft"))), false);

const suggested = suggestFromActive(start);
assert.equal(suggested.state.suggestions[0].id, "sug_active");
assert.equal(suggested.state.suggestions[0].tabs.length, 2);
const again = suggestFromActive(suggested.state);
assert.equal(again.state, suggested.state);

const allFiled = {
  ...start,
  active: start.active.map((tab) => ({ ...tab, project_id: tab.project_id || "prj_pasta" })),
};
assert.match(suggestFromActive(allFiled).status, /already in a project/);

console.log("preview checks passed");
