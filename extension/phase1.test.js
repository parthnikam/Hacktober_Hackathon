import assert from "node:assert/strict";
import { GEMMA_MODELS, buildPrompt, clusterTabs, normalizeTrails, parseModelJson, parseRecallPlan, testGeminiKey } from "./lib/gemini.js";
import { recallLocally } from "./lib/notebook.js";
import { excerptBudget, safeIcon, shouldSkipUrl } from "./lib/tabs.js";

const tabs = [
  {
    id: 1,
    windowId: 10,
    title: "KrowdKraft plan",
    url: "https://github.com/example/krowdkraft",
    favIconUrl: "https://github.com/favicon.ico",
    excerpt: "chrome extension memory graph",
  },
  {
    id: 2,
    windowId: 10,
    title: "Gemini structured output",
    url: "https://ai.google.dev/gemini-api/docs/structured-output",
    favIconUrl: "chrome://theme/icon",
    excerpt: "response json schema",
  },
  {
    id: 3,
    windowId: 11,
    title: "Pasta dough",
    url: "https://example.com/pasta",
    favIconUrl: "",
    excerpt: "flour eggs salt",
  },
];

for (const [url, skipped] of [
  ["chrome://newtab/", true],
  ["chrome-extension://abc/sidepanel.html", true],
  ["about:blank", true],
  ["devtools://devtools/bundled/inspector.html", true],
  ["https://example.com/pasta", false],
  ["", true],
  ["not a url", true],
]) {
  assert.equal(shouldSkipUrl(url), skipped, url);
}

assert.equal(excerptBudget(10), 1500);
assert.equal(excerptBudget(25), 800);
assert.equal(excerptBudget(50), 400);
assert.equal(safeIcon("chrome://favicon/"), "");
assert.equal(safeIcon("https://example.com/icon.png"), "https://example.com/icon.png");

const prompt = buildPrompt(tabs);
assert.match(prompt, /Group by task, not by website/);
assert.match(prompt, /exactly one trail/);
assert.match(prompt, /KrowdKraft plan/);
const withProjects = buildPrompt(tabs, [{ name: "KrowdKraft", intent: "File the tabs." }]);
assert.match(withProjects, /Existing projects/);
assert.match(withProjects, /that project's name exactly/);
assert.match(withProjects, /File the tabs/);

const normalized = normalizeTrails(
  [
    {
      label: "Hackathon",
      one_liner: "Building the tab grouper.",
      tab_ids: [1, 2, 1, 99],
      tab_notes: [
        { tab_id: 2, note: "API shape for the prompt." },
        { tab_id: 3, note: "wrong trail" },
      ],
    },
    { label: "Empty", one_liner: "no ids", tab_ids: [] },
  ],
  tabs,
);
assert.equal(normalized.length, 2);
assert.deepEqual(normalized[0].tab_ids, [1, 2]);
assert.deepEqual(normalized[0].tab_notes, [{ tab_id: 2, note: "API shape for the prompt." }]);
assert.equal(normalized[1].label, "Ungrouped");
assert.deepEqual(normalized[1].tab_ids, [3]);

assert.deepEqual(parseRecallPlan('{"related":true,"projects":["Sunday pasta"],"queries":["weeknight dough"]}'), {
  related: true,
  projects: ["Sunday pasta"],
  queries: ["weeknight dough"],
});
assert.deepEqual(parseRecallPlan('{"related":false,"projects":["Nope"],"queries":["nope"]}'), {
  related: false,
  projects: [],
  queries: [],
});
assert.equal(parseRecallPlan("not json").related, true);

const pastaNotebook = {
  projects: [
    { id: "b", name: "Sunday pasta", intent: "Weeknight dinner." },
    { id: "a", name: "KrowdKraft", intent: "File browser tabs." },
  ],
  links: [
    { id: "1", project_id: "b", url: "https://example.com/dough", title: "Pasta dough", note: "", saved_at: "2026-10-18" },
    { id: "2", project_id: "a", url: "https://example.com/plan", title: "Extension plan", note: "", saved_at: "2026-10-18" },
  ],
};
const byMeaning = recallLocally(pastaNotebook, "how should the noodles be mixed", new Date("2026-10-18T12:00:00"), {
  projectIds: ["b"],
  range: null,
});
assert.equal(byMeaning.length, 1);
assert.equal(byMeaning[0].metadata.title, "Pasta dough");
assert.equal(
  recallLocally(pastaNotebook, "how should the noodles be mixed", new Date("2026-10-18T12:00:00"), { range: null }).length,
  0,
);

assert.throws(() => parseModelJson("not json"), /not valid JSON/);
assert.deepEqual(parseModelJson('```json\n{"trails":[]}\n```').trails, []);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const calls = [];
const fakeFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, body });
  if (String(url).includes("gemini-3.5-flash")) {
    return jsonResponse(404, { error: { message: "model not found", code: 404 } });
  }
  const grouped = body.contents[0].parts[0].text.startsWith("Group these");
  const text = grouped
    ? JSON.stringify({
        trails: [
          {
            label: "Hackathon",
            one_liner: "Building the tab grouper.",
            tab_ids: [1, 2],
            tab_notes: [],
          },
          {
            label: "Dinner",
            one_liner: "Looking up pasta dough.",
            tab_ids: [3],
            tab_notes: [],
          },
        ],
      })
    : "ok";
  return jsonResponse(200, {
    candidates: [
      {
        content: {
          parts: [
            { thought: true, text: "thinking" },
            { text },
          ],
        },
      },
    ],
  });
};

const models = ["gemini-3.5-flash", "gemini-flash-latest"];
const testResult = await testGeminiKey("test-key", { fetch: fakeFetch, models });
assert.equal(testResult.model, "gemini-flash-latest");
assert.equal(testResult.text, "ok");

calls.length = 0;
const cluster = await clusterTabs("test-key", tabs, { fetch: fakeFetch, models });
assert.equal(cluster.model, "gemini-flash-latest");
assert.equal(cluster.trails.length, 2);
assert.equal(cluster.tabs[1].favIconUrl, "");
assert.equal("excerpt" in cluster.tabs[0], false);
assert.equal(calls.at(-1).body.generationConfig.responseMimeType, "application/json");
assert.equal(calls.filter((call) => call.url.includes("gemini-3.5-flash")).length > 0, true);
assert.deepEqual(GEMMA_MODELS, ["gemma-4-26b-a4b-it", "gemma-4-31b-it"]);

await assert.rejects(() => clusterTabs("", tabs, { fetch: fakeFetch, models }), /API key/);
await assert.rejects(() => clusterTabs("test-key", [], { fetch: fakeFetch, models }), /No readable tabs/);

console.log("phase 1 checks passed");
