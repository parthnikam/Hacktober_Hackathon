import { safeIcon } from "./tabs.js";

export const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-flash-latest"];

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

export function buildPrompt(tabs) {
  const payload = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    excerpt: tab.excerpt || "",
  }));
  return [
    "Group these open browser tabs into the projects the person is working on.",
    "",
    "Rules:",
    "- Group by task, not by website. Two GitHub tabs can be different projects. A docs tab and a forum tab can be the same project.",
    "- Put every tab id in exactly one trail.",
    "- label is a short project name.",
    "- one_liner is one sentence the person can read to remember what that pile of tabs is for.",
    "- tab_notes is optional. Add a note only when the tab's role is not obvious from its title.",
    "",
    "Tabs:",
    JSON.stringify(payload),
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
    throw new Error("Gemini returned text that was not valid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.trails)) {
    throw new Error("Gemini returned JSON without a trails list.");
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

async function postGenerate(doFetch, apiKey, model, body) {
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
    const error = new Error("Could not reach Gemini.");
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const text = responseText(data);
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "empty";
    throw new Error(`Gemini returned no text (${reason}).`);
  }
  return text;
}

async function generateWithFallback(doFetch, apiKey, models, body) {
  let lastError;
  for (const model of models) {
    try {
      const text = await postGenerate(doFetch, apiKey, model, body);
      return { model, text };
    } catch (error) {
      lastError = error;
      if (error.status === 404) continue;
      throw error;
    }
  }
  throw lastError || new Error("Gemini request failed.");
}

export async function testGeminiKey(apiKey, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini API key first.");
  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMINI_MODELS;
  return generateWithFallback(doFetch, key, models, {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word ok." }] }],
  });
}

export async function clusterTabs(apiKey, tabs, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Gemini API key in the options page.");
  if (!tabs?.length) throw new Error("No readable tabs are open.");

  const doFetch = options.fetch ?? globalThis.fetch;
  const models = options.models ?? GEMINI_MODELS;
  const prompt = buildPrompt(tabs);
  let generated;
  try {
    generated = await generateWithFallback(doFetch, key, models, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: TRAIL_SCHEMA,
        thinkingConfig: { thinkingLevel: "low" },
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
