import assert from "node:assert/strict";
import { speakText, transcribeClip } from "./lib/sarvam.js";
import { encodeWav } from "./lib/wav.js";

const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000);
let binary = "";
for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
const wavBase64 = btoa(binary);

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  if (String(url).endsWith("/speech-to-text")) {
    const text = new TextDecoder().decode(init.body);
    assert.match(init.headers["Content-Type"], /^multipart\/form-data; boundary=/);
    assert.equal(init.headers["api-subscription-key"], "test-key");
    assert.equal(text.includes('filename="clip.wav"'), true);
    assert.equal(text.includes("saaras:v4"), true);
    assert.equal(text.includes("transcribe"), true);
    assert.equal(text.includes("RIFF"), true);
    return { ok: true, json: async () => ({ transcript: " what was I on ", language_code: "hi-IN" }) };
  }
  return { ok: true, json: async () => ({ audios: ["UklGRg=="] }) };
};

const heard = await transcribeClip("test-key", wavBase64, { fetch: fakeFetch });
assert.deepEqual(heard, { transcript: "what was I on", language: "hi-IN" });

const spoken = await speakText("test-key", `  ${"a".repeat(2600)}`, { fetch: fakeFetch, language: "as-IN" });
const body = JSON.parse(calls[1].init.body);
assert.equal(body.text.length, 2500);
assert.equal(body.language_code, "en-IN");
assert.equal(body.model, undefined);
assert.equal(spoken.language, "en-IN");
assert.equal(spoken.audio, "UklGRg==");

await assert.rejects(() => transcribeClip("", new Uint8Array([1]), { fetch: fakeFetch }), /SARVAM_API_KEY/);
assert.equal(calls.length, 2);

const failed = async () => ({
  ok: false,
  status: 400,
  json: async () => ({ error: { message: "bad clip" } }),
});
await assert.rejects(() => transcribeClip("test-key", new Uint8Array([1, 2, 3]), { fetch: failed }), /wav file/);
await assert.rejects(() => transcribeClip("test-key", wav, { fetch: failed }), /bad clip/);

console.log("sarvam checks passed");
