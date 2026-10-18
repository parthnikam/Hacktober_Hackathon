// Mem0 Platform calls. The service worker is the only importer that should run these.

export const MEM0_HOST = "https://api.mem0.ai";

async function mem0Fetch(doFetch, apiKey, path, init) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Add a Mem0 API key in the options page.");
  let response;
  try {
    response = await doFetch(`${MEM0_HOST}${path}`, {
      ...init,
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error("Could not reach Mem0.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail || data?.error || data?.message;
    const message = typeof detail === "string" ? detail : `Mem0 request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export async function testMem0Key(apiKey, options = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  await mem0Fetch(doFetch, apiKey, "/v1/ping/", { method: "GET" });
  return { ok: true };
}

export async function addMemory(apiKey, userId, memory, options = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  return mem0Fetch(doFetch, apiKey, "/v3/memories/add/", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: memory.sentence }],
      user_id: userId,
      app_id: "krowdkraft",
      metadata: memory.metadata,
      timestamp: memory.timestamp,
    }),
  });
}

export async function addMemories(apiKey, userId, memories, options = {}) {
  const results = [];
  for (const memory of memories) {
    results.push(await addMemory(apiKey, userId, memory, options));
  }
  return results;
}

export async function searchMemories(apiKey, query, filters, options = {}) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const data = await mem0Fetch(doFetch, apiKey, "/v3/memories/search/", {
    method: "POST",
    body: JSON.stringify({ query, filters }),
  });
  const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  return { results };
}
