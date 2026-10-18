import assert from "node:assert/strict";
import {
  acceptSuggestion,
  createPreview,
  moveLink,
  projectPath,
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
