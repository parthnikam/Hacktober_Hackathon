import {
  GEMINI_API_KEY,
  MEM0_API_KEY,
  getGeminiApiKey,
  getMem0ApiKey,
  getMem0UserId,
  setGeminiApiKey,
  setMem0ApiKey,
  setMem0UserId,
  seedKeysFromEnv,
} from "./lib/storage.js";

const form = document.querySelector("#form");
const keyInput = document.querySelector("#key");
const testButton = document.querySelector("#test");
const clearButton = document.querySelector("#clear");
const status = document.querySelector("#status");
const stored = document.querySelector("#stored");

await seedKeysFromEnv();
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
  setStatus("Contacting Gemma…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "test-gemini", apiKey: key });
    if (!response?.ok) {
      setStatus(response?.error || "Gemma rejected the key.");
      return;
    }
    const savedHint = typed ? " Save the key so the side panel can use it." : "";
    setStatus(`Key works with ${response.model}.${savedHint}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not reach Gemma.");
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

const mem0Form = document.querySelector("#mem0-form");
const mem0KeyInput = document.querySelector("#mem0-key");
const mem0UserInput = document.querySelector("#mem0-user");
const mem0Test = document.querySelector("#mem0-test");
const mem0Clear = document.querySelector("#mem0-clear");
const mem0Status = document.querySelector("#mem0-status");
const mem0Stored = document.querySelector("#mem0-stored");

await showMem0State();

mem0Form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = mem0KeyInput.value.trim();
  const userId = mem0UserInput.value.trim();
  if (key) await setMem0ApiKey(key);
  if (userId) await setMem0UserId(userId);
  mem0KeyInput.value = "";
  setMem0Status("Saved on this computer.");
  await showMem0State();
});

mem0Test.addEventListener("click", async () => {
  const key = mem0KeyInput.value.trim() || (await getMem0ApiKey());
  mem0Test.disabled = true;
  setMem0Status("Contacting Mem0…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "test-mem0", apiKey: key });
    if (!response?.ok) {
      setMem0Status(response?.error || "Mem0 rejected the key.");
      return;
    }
    const savedHint = mem0KeyInput.value.trim() ? " Save the key so the side panel can use it." : "";
    setMem0Status(`Mem0 key works.${savedHint}`);
  } catch (error) {
    setMem0Status(error instanceof Error ? error.message : "Could not reach Mem0.");
  } finally {
    mem0Test.disabled = false;
  }
});

mem0Clear.addEventListener("click", async () => {
  await setMem0ApiKey("");
  mem0KeyInput.value = "";
  setMem0Status("Mem0 key removed.");
  await showMem0State();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[GEMINI_API_KEY]) showStoredState();
  if (area === "local" && (changes[MEM0_API_KEY] || changes.mem0UserId)) showMem0State();
});

async function showMem0State() {
  const key = await getMem0ApiKey();
  const userId = await getMem0UserId();
  mem0UserInput.placeholder = userId;
  mem0Stored.textContent = key
    ? `A Mem0 key is saved for user ${userId}.`
    : "No Mem0 key yet. Filing still works on this computer.";
}

function setMem0Status(text) {
  mem0Status.textContent = text;
}

async function showStoredState() {
  const key = await getGeminiApiKey();
  stored.textContent = key
    ? "A key is already saved on this computer."
    : "No key saved yet. The side panel needs one before it can group tabs.";
}

function setStatus(text) {
  status.textContent = text;
}
