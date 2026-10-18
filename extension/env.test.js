import assert from "node:assert/strict";
import { keysFromEnv, parseEnv } from "./lib/env.js";

const env = parseEnv(`
# comment
GEMINI_API_KEY=google-key
MEMO_API_KEY=memo-key
QUOTED="spaced value"
`);

assert.equal(env.GEMINI_API_KEY, "google-key");
assert.equal(env.QUOTED, "spaced value");
assert.deepEqual(keysFromEnv(env), { geminiApiKey: "google-key", mem0ApiKey: "memo-key" });
assert.equal(keysFromEnv({ MEM0_API_KEY: "platform-key", MEMO_API_KEY: "other" }).mem0ApiKey, "platform-key");

console.log("env checks passed");
