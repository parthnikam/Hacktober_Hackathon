// Sarvam speech. The service worker is the only importer that should run these.

export const SARVAM_HOST = "https://api.sarvam.ai";
const MISSING_KEY = "Add SARVAM_API_KEY to extension/.env and reload the extension.";
const TTS_LANGUAGES = new Set(["bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"]);

function speechLanguage(code) {
  const value = String(code || "").trim();
  return TTS_LANGUAGES.has(value) ? value : "en-IN";
}

function asBytes(audio) {
  if (typeof audio === "string") {
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio);
  if (ArrayBuffer.isView(audio)) return new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
  return new Uint8Array();
}

function wavRequest(bytes) {
  if (bytes.length < 44 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF") {
    throw new Error("The recording was not a wav file.");
  }
  const boundary = "----krowdkraftwav";
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    bytes,
    encoder.encode(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nsaaras:v4\r\n--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\ntranscribe\r\n--${boundary}--\r\n`,
    ),
  ];
  const body = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function sarvamError(response) {
  const data = await response.json().catch(() => ({}));
  const detail = data?.error?.message || data?.message;
  return new Error(typeof detail === "string" && detail ? detail : `Sarvam request failed (${response.status}).`);
}

export async function transcribeClip(apiKey, audio, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error(MISSING_KEY);
  const doFetch = options.fetch ?? globalThis.fetch;
  const wav = wavRequest(asBytes(audio));
  let response;
  try {
    response = await doFetch(`${SARVAM_HOST}/speech-to-text`, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": wav.contentType,
      },
      body: wav.body,
    });
  } catch {
    throw new Error("Could not reach Sarvam.");
  }
  if (!response.ok) throw await sarvamError(response);
  const data = await response.json().catch(() => ({}));
  return {
    transcript: String(data.transcript || "").trim(),
    language: String(data.language_code || "").trim(),
  };
}

export async function speakText(apiKey, text, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error(MISSING_KEY);
  const spoken = String(text || "").trim().slice(0, 2500);
  if (!spoken) throw new Error("Nothing to say.");
  const language = speechLanguage(options.language);
  const doFetch = options.fetch ?? globalThis.fetch;
  let response;
  try {
    response = await doFetch(`${SARVAM_HOST}/text-to-speech`, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: spoken, language_code: language }),
    });
  } catch {
    throw new Error("Could not reach Sarvam.");
  }
  if (!response.ok) throw await sarvamError(response);
  const data = await response.json().catch(() => ({}));
  const audio = Array.isArray(data.audios) ? String(data.audios.find(Boolean) || "") : "";
  if (!audio) throw new Error("Sarvam returned no audio.");
  return { audio, language };
}
