export function mountErrorBox(root) {
  const seen = new Set();
  const entries = [];
  const summary = root?.querySelector("summary");
  const list = root?.querySelector("[data-error-list]");

  function showError(message, stack = "", where = "") {
    const text = String(message || "Something went wrong.").trim();
    if (!root || !text) return;
    const detail = String(stack || "").trim();
    const key = `${where}\n${text}\n${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ text, detail, where: String(where || "").trim() });
    if (entries.length > 8) {
      const dropped = entries.shift();
      seen.delete(`${dropped.where}\n${dropped.text}\n${dropped.detail}`);
    }
    root.hidden = false;
    const latest = entries[entries.length - 1];
    if (summary) summary.textContent = entries.length > 1 ? `${entries.length} errors. ${latest.text}` : latest.text;
    if (!list) return;
    list.replaceChildren();
    for (const entry of [...entries].reverse()) {
      const block = document.createElement("pre");
      const head = entry.where ? `${entry.where}\n` : "";
      block.textContent = `${head}${entry.text}${entry.detail ? `\n${entry.detail}` : ""}`.trim();
      list.append(block);
    }
  }

  window.addEventListener("error", (event) => {
    showError(event.error?.message || event.message, event.error?.stack || "");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    showError(error.message, error.stack || "");
  });

  return showError;
}
