import assert from "node:assert/strict";
import { runAgent } from "./lib/agent.js";
import { acceptTrail } from "./lib/notebook.js";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const calls = [];
function scripted(parts) {
  calls.length = 0;
  let step = 0;
  return async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const part = parts[Math.min(step, parts.length - 1)];
    step += 1;
    return jsonResponse({ candidates: [{ content: { parts: part } }] });
  };
}

const search = await runAgent({
  apiKey: "test-key",
  question: "what was I looking at last week about speech",
  models: ["gemma-test"],
  fetch: scripted([
    [{ functionCall: { name: "search_memory", args: { query: "speech last week" } } }],
    [{ text: "You were on KrowdKraft, reading the speech docs." }],
  ]),
  callTool(name, args) {
    assert.equal(name, "search_memory");
    assert.equal(args.query, "speech last week");
    return {
      memories: [{ memory: "saved the speech docs", project_name: "KrowdKraft" }],
      projects: ["KrowdKraft"],
      sources: [{ title: "Speech docs", url: "https://docs.example/speech" }],
    };
  },
});
assert.equal(search.text, "You were on KrowdKraft, reading the speech docs.");
assert.deepEqual(search.projects, ["KrowdKraft"]);
assert.equal(search.filed, false);
assert.deepEqual(search.sources, [{ title: "Speech docs", url: "https://docs.example/speech" }]);
assert.equal(calls[1].contents[2].parts[0].functionResponse.name, "search_memory");
assert.ok(calls[0].tools[0].functionDeclarations.some((tool) => tool.name === "file_links"));

calls.length = 0;
const filed = await runAgent({
  apiKey: "test-key",
  question: "I am working on Sunday pasta. File these tabs.",
  models: ["gemma-test"],
  fetch: scripted([
    [{ functionCall: { name: "list_tabs", args: {} } }],
    [{ functionCall: { name: "file_links", args: { project: "Sunday pasta", intent: "Dinner.", tab_ids: [3] } } }],
    [{ text: "Filed the pasta tab under Sunday pasta." }],
  ]),
  callTool(name) {
    if (name === "list_tabs") {
      return {
        tabs: [
          { id: 3, title: "Pasta dough", url: "https://example.com/pasta" },
          { id: 4, title: "Other", url: "https://example.com/other" },
        ],
      };
    }
    return {
      filed: true,
      project: "Sunday pasta",
      linkCount: 1,
      sources: [{ title: "Pasta dough", url: "https://example.com/pasta" }],
    };
  },
});
assert.equal(filed.filed, true);
assert.deepEqual(filed.projects, ["Sunday pasta"]);
assert.deepEqual(filed.sources, [{ title: "Pasta dough", url: "https://example.com/pasta" }]);
assert.match(filed.text, /Sunday pasta/);

calls.length = 0;
await runAgent({
  apiKey: "test-key",
  question: "keep going",
  models: ["gemma-test"],
  maxRounds: 2,
  fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const part = body.tools
      ? [{ functionCall: { name: "list_tabs", args: {} } }]
      : [{ text: "Stopped." }];
    return jsonResponse({ candidates: [{ content: { parts: part } }] });
  },
  callTool() {
    return { tabs: [] };
  },
});
assert.equal(calls.length, 3);
assert.equal("tools" in calls[2], false);

calls.length = 0;
const missed = await runAgent({
  apiKey: "test-key",
  question: "where did I leave the camping stove",
  models: ["gemma-test"],
  fetch: scripted([
    [{ functionCall: { name: "search_memory", args: { query: "where did I leave the camping stove" } } }],
    [{ text: "You were probably cooking outside." }],
  ]),
  callTool() {
    return { memories: [], sources: [], projects: [] };
  },
});
assert.equal(missed.text, "oops. i don't have that in my memory");
assert.deepEqual(missed.sources, []);

const once = acceptTrail(
  { projects: [], links: [] },
  { label: "KrowdKraft", one_liner: "File tabs.", tab_ids: [1], tab_notes: [] },
  [{ id: 1, title: "Plan", url: "https://example.com/plan#top" }],
);
const twice = acceptTrail(
  once.notebook,
  { label: "KrowdKraft", one_liner: "File tabs.", tab_ids: [2], tab_notes: [] },
  [{ id: 2, title: "Plan again", url: "https://example.com/plan" }],
);
assert.equal(twice.links.length, 0);
assert.equal(twice.notebook.links.length, 1);

console.log("agent checks passed");
