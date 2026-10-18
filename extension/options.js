import { GEMINI_API_KEY, getGeminiApiKey, setGeminiApiKey } from "./lib/storage.js";

const form = document.querySelector("#form");
const keyInput = document.querySelector("#key");
const testButton = document.querySelector("#test");
const clearButton = document.querySelector("#clear");
const status = document.querySelector("#status");
const stored = document.querySelector("#stored");

await showStoredState();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key) {
    setStatus("Paste a key before saving.");
    return;
  }
  await setGeminiApiKey(key);
  keyInput.value = "";
  setStatus("Saved on this computer.");
  await showStoredState();
});

testButton.addEventListener("click", async () => {
  const typed = keyInput.value.trim();
  const key = typed || (await getGeminiApiKey());
  testButton.disabled = true;
  setStatus("Contacting Gemini…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "test-gemini", apiKey: key });
    if (!response?.ok) {
      setStatus(response?.error || "Gemini rejected the key.");
      return;
    }
    const savedHint = typed ? " Save the key so the side panel can use it." : "";
    setStatus(`Key works with ${response.model}.${savedHint}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not reach Gemini.");
  } finally {
    testButton.disabled = false;
  }
});

clearButton.addEventListener("click", async () => {
  await setGeminiApiKey("");
  keyInput.value = "";
  setStatus("Key removed.");
  await showStoredState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[GEMINI_API_KEY]) showStoredState();
});

async function showStoredState() {
  const key = await getGeminiApiKey();
  stored.textContent = key
    ? "A key is already saved on this computer."
    : "No key saved yet. The side panel needs one before it can group tabs.";
}

function setStatus(text) {
  status.textContent = text;
}
