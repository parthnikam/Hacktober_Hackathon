import { samePage } from "./groups.js";
import { generateContent } from "./gemini.js";

export const AGENT_TOOLS = [
  {
    name: "search_memory",
    description: "Search projects and links that were already filed. Use this for questions about past work.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question, including a project name or a time such as last week when the user said one.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tabs",
    description: "List the tabs open right now, including their ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "file_links",
    description:
      "File open tabs into a project and remember them. Reuse an existing project name when the work matches. Call list_tabs first.",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name." },
        intent: { type: "string", description: "One sentence about what the work is for." },
        tab_ids: { type: "array", items: { type: "integer" } },
      },
      required: ["project", "tab_ids"],
    },
  },
];

export function buildAgentPrompt(question) {
  return [
    "You are the memory for this person's browser projects.",
    "A project stays after its tabs are closed.",
    "Use a tool when you need facts. Do not invent saved links.",
    "search_memory answers questions about what they filed.",
    "list_tabs is for what is open now.",
    "file_links is for when they say what they are working on and want those tabs filed. Call list_tabs first so the tab ids are real.",
    "Then answer in one short paragraph and name the project.",
    "",
    `Question: ${question}`,
  ].join("\n");
}

function visibleParts(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => part && !part.thought);
}

function callArgs(args) {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args;
}

function functionCalls(data) {
  return visibleParts(data)
    .filter((part) => part.functionCall?.name)
    .map((part) => ({
      name: part.functionCall.name,
      args: callArgs(part.functionCall.args),
      id: part.functionCall.id,
    }));
}

function answerText(data) {
  return visibleParts(data)
    .filter((part) => part.text)
    .map((part) => part.text)
    .join("")
    .trim();
}

async function complete(apiKey, body, options) {
  try {
    return await generateContent(apiKey, body, options);
  } catch (error) {
    if (error.status !== 400 || !body.generationConfig) throw error;
    const next = { ...body };
    delete next.generationConfig;
    return generateContent(apiKey, next, options);
  }
}

function collectSources(list, bucket) {
  for (const source of list || []) {
    const url = String(source?.url || "").trim();
    const title = String(source?.title || url).trim();
    if (!url || bucket.some((item) => samePage(item.url, url))) continue;
    bucket.push({ title, url });
  }
}

export async function runAgent({ apiKey, question, callTool, maxRounds = 4, ...options }) {
  const contents = [{ role: "user", parts: [{ text: buildAgentPrompt(question) }] }];
  const projects = new Set();
  const sources = [];
  const listed = [];
  let filed = false;
  let warning = "";

  for (let round = 0; round <= maxRounds; round += 1) {
    const forceAnswer = round === maxRounds;
    const body = {
      contents,
      generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } },
    };
    if (!forceAnswer) body.tools = [{ functionDeclarations: AGENT_TOOLS }];
    const generated = await complete(apiKey, body, options);
    const calls = forceAnswer ? [] : functionCalls(generated.data);
    const text = answerText(generated.data);
    if (calls.length === 0) {
      return {
        text: text || "Nothing filed matches that.",
        model: generated.model,
        projects: [...projects],
        sources: sources.length ? sources : listed,
        filed,
        warning,
      };
    }

    contents.push({
      role: "model",
      parts: calls.map((call) => ({
        functionCall: { name: call.name, args: call.args, ...(call.id ? { id: call.id } : {}) },
      })),
    });
    const responses = [];
    for (const call of calls) {
      let payload;
      try {
        payload = await callTool(call.name, call.args);
      } catch (error) {
        payload = { error: error instanceof Error ? error.message : "That tool failed." };
      }
      if (!payload || typeof payload !== "object") payload = { result: payload };
      if (payload.warning) warning = payload.warning;
      if (payload.filed) filed = true;
      if (call.name === "list_tabs") collectSources(payload.tabs, listed);
      else collectSources(payload.sources, sources);
      if (payload.project) projects.add(payload.project);
      for (const name of payload.projects || []) {
        if (name) projects.add(name);
      }
      responses.push({
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: payload,
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return {
    text: "Nothing filed matches that.",
    model: "",
    projects: [...projects],
    sources: sources.length ? sources : listed,
    filed,
    warning,
  };
}
