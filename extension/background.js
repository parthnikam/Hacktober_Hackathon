import { clusterTabs, testGeminiKey } from "./lib/gemini.js";
import { getGeminiApiKey, saveLastCluster } from "./lib/storage.js";
import { collectTabs } from "./lib/tabs.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cluster-tabs") {
    runCluster()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message?.type === "test-gemini") {
    testGeminiKey(message.apiKey)
      .then((result) => sendResponse({ ok: true, model: result.model }))
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  return false;
});

async function runCluster() {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error("Add a Gemini API key in the options page.");
  const tabs = await collectTabs();
  const result = await clusterTabs(apiKey, tabs);
  await saveLastCluster(result);
  return result;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Could not group tabs.";
}
