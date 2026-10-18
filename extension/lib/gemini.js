import { safeIcon } from "./tabs.js";

export const GEMMA_MODELS = ["gemma-4-26b-a4b-it", "gemma-4-31b-it"];

const TRAIL_SCHEMA = {
  type: "object",
  properties: {
    trails: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short project name." },
          one_liner: {
            type: "string",
            description: "One sentence about what this pile of tabs is for.",
          },
          tab_ids: {
            type: "array",
            items: { type: "integer" },
          },
          tab_notes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tab_id: { type: "integer" },
                note: { type: "string" },
              },
              required: ["tab_id", "note"],
            },
          },
        },
        required: ["label", "one_liner", "tab_ids", "tab_notes"],
      },
    },
  },
  required: ["trails"],
};

export function buildPrompt(tabs, projects = []) {
  const payload = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    excerpt: tab.excerpt || "",
  }));
  const known = (projects || [])
    .map((project) => ({
      name: String(project?.name || "").trim(),
      intent: String(project?.intent || "").trim(),
    }))
    .filter((project) => project.name);
  const rules = [
    "- Group by task, not by website. Two GitHub tabs can be different projects. A docs tab and a forum tab can be the same project.",
    "- Put every tab id in exactly one trail.",
    "- label is a short project name.",
    "- one_liner is one sentence the person can read to remember what that pile of tabs is for.",
    "- tab_notes is optional. Add a note only when the tab's role is not obvious from its title.",
  ];
  if (known.length) {
    rules.push("- If the tabs belong to an existing project, label must be that project's name exactly.");
    rules.push("- Invent a new label only when none of the existing projects fit.");
  }
  return [
    "Group these open browser tabs into the projects the person is working on.",
    "",
    "Rules:",
    ...rules,
    "",
    "Tabs:",
    JSON.stringify(payload),
    ...(known.length ? ["", "Existing projects:", JSON.stringify(known)] : []),
  ].join("\n");
}

export function parseModelJson(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Gemma returned text that was not valid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.trails)) {
    throw new Error("Gemma returned JSON without a trails list.");
  }
  return parsed;
}

export function normalizeTrails(rawTrails, tabs) {
  const known = new Set(tabs.map((tab) => tab.id));
  const used = new Set();
  const trails = [];

  for (const raw of rawTrails || []) {
    const tabIds = [];
    for (const id of raw?.tab_ids || []) {
      const numeric = Number(id);
      if (!known.has(numeric) || used.has(numeric)) continue;
      used.add(numeric);
      tabIds.push(numeric);
    }
    if (tabIds.length === 0) continue;

    const notes = [];
    for (const note of raw?.tab_notes || []) {
      const numeric = Number(note?.tab_id);
      const text = String(note?.note || "").trim();
      if (!tabIds.includes(numeric) || !text) continue;
      notes.push({ tab_id: numeric, note: text });
    }

    trails.push({
      label: String(raw?.label || "").trim() || "Untitled",
      one_liner: String(raw?.one_liner || "").trim(),
      tab_ids: tabIds,
      tab_notes: notes,
    });
  }

  const missing = tabs.filter((tab) => !used.has(tab.id)).map((tab) => tab.id);
  if (missing.length > 0) {
    trails.push({
      label: "Ungrouped",
      one_liner: "These tabs were still open and did not fit another group.",
      tab_ids: missing,
      tab_notes: [],
    });
  }
  return trails;
}

export function snapshotTabs(tabs) {
  return tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    favIconUrl: safeIcon(tab.favIconUrl),
  }));
}

function responseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part && !part.thought && part.text)
    .map((part) => part.text)
    .join("");
}

async function requestModel(doFetch, apiKey, model, body) {
  let response;
  try {
    response = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    const error = new Error("Could not reach Gemma.");
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Gemma request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function generateWithFallback(doFetch, apiKey, models, body) {
  let lastError;
  for (const model of models) {
    try {
      const data = await requestModel(doFetch, apiKey, model, body);
      const text = responseText(data);
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "empty";
        throw new Error(`Gemma returned no text (${reason}).`);
      }
      return { model, text };
    } catch (error) {
      lastError = error;
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw lastError || new Error("Gemma request failed.");
}

export async function generateContent(apiKey, body, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemma API key in the options page.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  let lastError;
  for (const model of models) {
    try {
      const data = await requestModel(doFetch, key, model, body);
      return { model, data };
    } catch (error) {
      lastError = error;
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw lastError || new Error("Gemma request failed.");
}

export async function testGeminiKey(apiKey, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemma API key first.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  return generateWithFallback(doFetch, key, models, {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word ok." }] }],
  });
}

async function generateJson(doFetch, apiKey, models, prompt, schema) {
  const body = (thinking) => ({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
    },
  });
  try {
    return await generateWithFallback(doFetch, apiKey, models, body(true));
  } catch (error) {
    if (error.status !== 400) throw error;
    return generateWithFallback(doFetch, apiKey, models, body(false));
  }
}

export async function clusterTabs(apiKey, tabs, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemma API key in the options page.");
  if (!tabs?.length) throw new Error("No readable tabs are open.");

  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  const prompt = buildPrompt(tabs, options.projects);
  let generated;
  try {
    generated = await generateWithFallback(doFetch, key, models, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: TRAIL_SCHEMA,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });
  } catch (error) {
    if (error.status !== 400) throw error;
    generated = await generateWithFallback(doFetch, key, models, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: TRAIL_SCHEMA,
      },
    });
  }

  const parsed = parseModelJson(generated.text);
  return {
    savedAt: new Date().toISOString(),
    model: generated.model,
    tabs: snapshotTabs(tabs),
    trails: normalizeTrails(parsed.trails, tabs),
  };
}

export function buildAnswerPrompt(question, memories) {
  const facts = (memories || [])
    .map((memory) => {
      const project = memory?.metadata?.project_name;
      const line = memory?.memory || memory?.sentence || "";
      return project ? `- ${line} (project: ${project})` : `- ${line}`;
    })
    .filter((line) => line !== "- ")
    .join("\n");
  return [
    "Answer the question using the filed memories.",
    "If they do not contain the answer, say you do not have that filed.",
    "Name the project when a memory belongs to one.",
    "",
    `Question: ${question}`,
    "",
    "Memories:",
    facts || "(none)",
  ].join("\n");
}

export function formatMemories(memories) {
  const lines = (memories || []).map((memory) => memory?.memory || memory?.sentence || "").filter(Boolean);
  if (lines.length === 0) return "Nothing filed matches that.";
  return lines.join("\n");
}

export async function answerFromMemories(apiKey, question, memories, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) return { text: formatMemories(memories), model: "" };
  if (!memories?.length) return { text: "Nothing filed matches that.", model: "" };
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  const generated = await generateWithFallback(doFetch, key, models, {
    contents: [{ role: "user", parts: [{ text: buildAnswerPrompt(question, memories) }] }],
  });
  return { text: generated.text.trim(), model: generated.model };
}

const COMMAND_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", description: "watch, stop, or none." },
    title: { type: "string", description: "Short project title, or empty." },
    intent: { type: "string", description: "One sentence, or empty." },
  },
  required: ["action", "title", "intent"],
};

const RELATED_SCHEMA = {
  type: "object",
  properties: {
    related: { type: "boolean", description: "True when the tab should join the project." },
  },
  required: ["related"],
};

export function buildProjectCommandPrompt(message, projects = []) {
  const names = (projects || []).map((project) => String(project?.name || "").trim()).filter(Boolean);
  return [
    "The user is talking to a browser extension that files new tabs into one current project.",
    "Decide what this message is.",
    "action is watch when they name the project they are working on now, including a bare project name.",
    "title is a short name, at most four words, using their words. Do not invent a different project.",
    names.length
      ? `Existing projects: ${names.join(", ")}. If they mean one of these, title must be that project's name exactly.`
      : "",
    "intent is one sentence about why the work is happening, or empty if they did not say.",
    "action is stop when they say to stop adding tabs, or that they are done with the current project.",
    "action is none when they ask a question, want tabs that are already open filed, or are not naming the current project.",
    "If the message both names a project and asks to file tabs that are already open, action is none.",
    "The message 'I am working on Sunday pasta for dinner' is watch, title Sunday pasta, intent dinner.",
    "The message 'KrowdKraft' is watch, title KrowdKraft, intent empty.",
    "The message 'File these tabs under Sunday pasta' is none.",
    "The message 'stop adding tabs' is stop.",
    "",
    `Message: ${message}`,
  ].join("\n");
}

export function parseProjectCommand(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { action: "none", title: "", intent: "" };
  }
  const action = String(parsed?.action || "").trim().toLowerCase();
  const intent = String(parsed?.intent || "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (action === "stop") return { action: "stop", title: "", intent: "" };
  const title = String(parsed?.title || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .slice(0, 48)
    .trim();
  if (action === "watch" && title) return { action: "watch", title, intent };
  return { action: "none", title: "", intent: "" };
}

export function buildRelatedPrompt(project, tab) {
  const name = String(project?.name || "").trim();
  const intent = String(project?.intent || "").trim();
  const known = (project?.links || [])
    .map((link) => String(link?.title || "").trim())
    .filter(Boolean)
    .slice(-6);
  return [
    `Project: ${name}`,
    intent ? `Intent: ${intent}` : "",
    known.length ? `Already filed: ${known.join(", ")}` : "",
    "",
    "A new browser tab opened.",
    `Title: ${String(tab?.title || "").trim()}`,
    `URL: ${String(tab?.url || "").trim()}`,
    tab?.excerpt ? `Excerpt: ${String(tab.excerpt).trim().slice(0, 400)}` : "",
    "",
    "Join the project when the tab is even loosely related.",
    "A search, a document, a tool, or a nearby topic counts.",
    "Leave it out only when it is clearly a different task.",
    "A start page, an empty search box, and mail or news that do not mention the project stay out.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseRelated(text) {
  const trimmed = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  return parsed?.related === true || parsed?.related === "true";
}

export async function readProjectCommand(apiKey, message, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemma API key in the options page.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  const generated = await generateJson(
    doFetch,
    key,
    models,
    buildProjectCommandPrompt(message, options.projects),
    COMMAND_SCHEMA,
  );
  return parseProjectCommand(generated.text);
}

export async function tabBelongsToProject(apiKey, project, tab, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemma API key in the options page.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMMA_MODELS;
  const generated = await generateJson(doFetch, key, models, buildRelatedPrompt(project, tab), RELATED_SCHEMA);
  return parseRelated(generated.text);
}
