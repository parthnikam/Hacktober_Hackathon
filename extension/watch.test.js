import assert from "node:assert/strict";
import { acceptTrail } from "./lib/notebook.js";
import {
  buildProjectCommandPrompt,
  parseProjectCommand,
  parseRelated,
  readProjectCommand,
  tabBelongsToProject,
} from "./lib/gemini.js";
import { directTitle, isQuestion, isStopCommand, watchDecision } from "./lib/watch.js";

const project = { id: "prj_pasta", name: "Sunday pasta" };
const links = [
  { project_id: "prj_pasta", url: "https://example.com/pasta#top" },
  { project_id: "prj_other", url: "https://example.com/mail" },
];

assert.equal(isQuestion("what was I working on last week?"), true);
assert.equal(isQuestion("I'm working on Sunday pasta"), false);
assert.equal(isStopCommand("Stop."), true);
assert.equal(isStopCommand("I'm working on Sunday pasta"), false);
assert.equal(directTitle("I'm working on Sunday pasta"), "Sunday pasta");
assert.equal(directTitle("the project is KrowdKraft"), "KrowdKraft");
assert.equal(directTitle("file these tabs"), "");
assert.equal(directTitle("Sunday pasta"), "");

assert.equal(
  watchDecision({
    project,
    tab: { id: 1, url: "https://example.com/pasta", title: "Dough" },
    links,
    seenUrl: "",
  }),
  "group",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 2, url: "https://example.com/mail", title: "Inbox" },
    links,
    seenUrl: "",
  }),
  "skip",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 3, url: "https://example.com/recipe", title: "Weeknight ragu" },
    links,
    seenUrl: "",
  }),
  "ask",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 3, url: "https://example.com/recipe", title: "Weeknight ragu" },
    links,
    seenUrl: "https://example.com/recipe",
  }),
  "skip",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 4, url: "chrome://newtab/", title: "New Tab" },
    links,
    seenUrl: "",
  }),
  "skip",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 5, url: "https://example.com/new", title: "New Tab", pinned: true },
    links,
    seenUrl: "",
  }),
  "skip",
);
assert.equal(
  watchDecision({
    project,
    tab: { id: 6, url: "https://example.com/new", title: "New Tab" },
    links,
    seenUrl: "",
  }),
  "wait",
);

assert.deepEqual(parseProjectCommand('{"action":"watch","title":"Sunday pasta","intent":"Dinner."}'), {
  action: "watch",
  title: "Sunday pasta",
  intent: "Dinner.",
});
assert.deepEqual(parseProjectCommand('{"action":"stop","title":"ignored","intent":""}'), {
  action: "stop",
  title: "",
  intent: "",
});
assert.equal(parseProjectCommand("not json").action, "none");
assert.equal(parseProjectCommand('{"action":"watch","title":"","intent":""}').action, "none");
assert.equal(parseRelated('{"related":true}'), true);
assert.equal(parseRelated('{"related":false}'), false);
assert.equal(parseRelated("nope"), false);
assert.match(buildProjectCommandPrompt("the mem0 work", [{ name: "Mem0" }]), /name exactly/);

const filed = acceptTrail(
  { projects: [], links: [] },
  { label: "Sunday pasta", one_liner: "Dinner.", tab_ids: [], tab_notes: [] },
  [],
);
assert.equal(filed.created, true);
assert.equal(filed.project.name, "Sunday pasta");
assert.equal(filed.links.length, 0);
assert.ok(filed.memories.some((memory) => memory.kind === "project"));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const command = await readProjectCommand("test-key", "I am working on Sunday pasta", {
  models: ["gemma-test"],
  fetch: async () =>
    jsonResponse({
      candidates: [{ content: { parts: [{ text: '{"action":"watch","title":"Sunday pasta","intent":"Dinner."}' }] } }],
    }),
});
assert.equal(command.action, "watch");
assert.equal(command.title, "Sunday pasta");

const related = await tabBelongsToProject(
  "test-key",
  { name: "Sunday pasta", intent: "Dinner.", links: [] },
  { title: "Ragu recipe", url: "https://example.com/ragu", excerpt: "tomato" },
  {
    models: ["gemma-test"],
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(typeof body.generationConfig.responseJsonSchema.properties.related.type, "string");
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"related":true}' }] } }],
      });
    },
  },
);
assert.equal(related, true);

console.log("watch checks passed");
