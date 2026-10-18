# Plan: Context for Humans

A Chrome extension that looks at open tabs, groups them into the projects you were actually working on, and keeps a memory of those trails so you can ask about them later.

The README’s order is the build order. Each phase is demoable on its own. Do not start a later phase until the earlier one works in the browser.

`test.py` (local Gemma) is a separate experiment. This plan does not use it. The extension calls Gemini Flash over the API.

## Product

You leave a pile of tabs and forget why they are open. The extension should:

- Read every open tab (title, URL, and a short slice of page text).
- Group tabs that belong to the same effort.
- Attach one short line to each group, and to a tab when it needs its own note.
- Draw those groups as a memory graph of search trails.
- Remember trails after the tabs are gone, through [mem0](https://github.com/mem0ai/mem0).
- Take a spoken command through Sarvam speech-to-text and answer from that memory.
- Use a small agent loop when a question needs tools (list tabs, search memory, save a trail). A single prompt that always does the same thing is not enough.

Two surfaces:

- **Side panel.** Current groups, one-liners, a text box, and a push-to-talk button.
- **Graph page.** Full-tab view of trails. Nodes are trails. A trail contains its tabs. Edges appear when two trails share a site or one search continued into the other.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Extension | Manifest V3, plain JS, no framework | Smallest thing that can read tabs and render HTML |
| Tabs | `chrome.tabs` + `chrome.scripting` | Title and URL are free. Page text needs a script injected into the tab |
| LLM | Gemini Flash, model `gemini-3.5-flash` | README. If the key rejects that id, use `gemini-flash-latest` |
| Memory | Mem0 Platform REST (`https://api.mem0.ai`) | The Python library needs a vector store. The extension cannot host that |
| Speech | Sarvam `POST /speech-to-text`, model `saaras:v4`, mode `transcribe` | Short push-to-talk clips. REST is the right endpoint for clips under 30 seconds |
| Graph (phase 2) | One HTML page and a few dozen lines of SVG | The README asks to prove HTML graph rendering, not to pick a chart library |

Keys live in `chrome.storage.local`, typed into an options page. Nothing is committed.

Host permissions the extension needs:

- `https://generativelanguage.googleapis.com/*`
- `https://api.mem0.ai/*`
- `https://api.sarvam.ai/*`
- `<all_urls>` only when phase 1 starts reading page text. Title and URL need `tabs` only.

## What this hackathon build does not include

- A backend of our own.
- Mem0 open-source self-hosting.
- Continuous listening. Push-to-talk only.
- Syncing Chrome’s built-in tab groups. We group by meaning, then draw our own graph.
- Login, multi-user, or a packaged Web Store listing. Load unpacked.

## Repo shape

```
extension/
  manifest.json
  background.js          service worker: tabs, Gemini, mem0, agent loop
  sidepanel.html
  sidepanel.js
  sidepanel.css
  graph.html             phase 2 page
  graph.js
  options.html
  options.js
  lib/
    tabs.js
    gemini.js
    memory.js            phase 3
    agent.js             phase 4
    sarvam.js            phase 4
```

Keep each file doing one job. The service worker is the only place that calls the network.

## Phase 1 — Tabs through the LLM

Goal: press one button and see groups with a one-line note each.

1. Scaffold the extension. Permissions: `tabs`, `storage`, `sidePanel`. Add `scripting` and `<all_urls>` when excerpts are wired.
2. `chrome.tabs.query({})` returns `{ id, title, url, favIconUrl }` for every window. Drop `chrome://`, `chrome-extension://`, and the new-tab page.
3. For each remaining tab, inject a function that returns `document.title` plus the first ~1500 characters of visible text. Skip a tab that throws (PDF, Chrome Web Store, hung page) and keep title plus URL.
4. Send that list to Gemini with a JSON schema. Ask for:

```json
{
  "trails": [
    {
      "label": "short project name",
      "one_liner": "what this pile of tabs is for",
      "tab_ids": [1, 2],
      "tab_notes": [{ "tab_id": 1, "note": "optional, only if the tab is not obvious" }]
    }
  ]
}
```

Rules for the prompt: group by task, not by domain. Two GitHub tabs can be different projects. A docs tab and a Stack Overflow tab can be the same project. Every open tab appears in exactly one trail. `one_liner` is one sentence a person can read in the side panel.

5. Render the JSON in the side panel. Show the label, the one-liner, and the tab titles. Clicking a tab calls `chrome.tabs.update` to focus it.
6. Store the last result in `chrome.storage.local` so the panel survives a reload.

Done when: with two obvious projects open (for example a hackathon repo and a recipe), one click produces two trails and the one-liners match what is on screen.

## Phase 2 — Graph page, mock data first

Goal: an extension page that draws a graph. Real tab data comes after the drawing works.

1. Add `graph.html` as an extension page (`chrome.runtime.getURL`) opened from the side panel.
2. Draw with SVG. No library.
   - A trail is a labeled circle.
   - Its tabs are smaller circles around it, linked to the trail.
   - An edge between trails is a line, used only when the data says they are related.
3. Feed it a hard-coded fixture of three trails so layout bugs are obvious.
4. Then replace the fixture with the phase 1 JSON from `chrome.storage.local`. Tabs with no group yet are a single “Ungrouped” node.
5. Click a tab node to focus that tab. Click a trail node to list its one-liner under the graph.

Layout can be fixed positions in a circle. A force simulation is optional and only worth it if the circle layout is unreadable past ~8 trails.

Done when: the graph page opens from the side panel, shows the latest clustering, and focusing a tab works.

## Phase 3 — Memory

Goal: close the tabs, ask in the text box, and get the trail back.

Use one `user_id` stored in options (default `local-user`). All calls go to the Mem0 Platform API with the key from options.

Write, after every successful clustering:

- One memory per trail: label, one-liner, page titles, and URLs.
- Metadata: `{ "kind": "trail", "trail_label": "...", "saved_at": "<iso>" }`.
- Message content is a plain sentence, because mem0 extracts facts from text. Example: “On 2026-10-17 the user was working on KrowdKraft: a Chrome extension that groups tabs. Open pages included the mem0 docs and the Sarvam speech-to-text docs.”

Read, when the side panel question box is submitted:

1. `POST /v2/memories/search/` with the question and `filters: { "user_id": "<id>" }`.
2. Pass the top memories plus the question to Gemini.
3. Show the answer, and under it the trail labels that were used.

Also add a “What was I working on?” button that searches for recent trails and lists them without a free-form question.

Do not send the raw page body to mem0. Titles, URLs, and the one-liner are the memory. Page excerpts stay in the phase 1 prompt and are discarded.

Done when: cluster a session, close those tabs, reload Chrome, ask “what was I looking up about speech to text?”, and the answer names the trail.

## Phase 4 — Voice, a small agent, and a tighter UI

Goal: the demo can be done by talking, and the model can choose a tool instead of always clustering.

### Voice

- Push-to-talk in the side panel. `MediaRecorder` writes audio while the button is held.
- Send the clip to Sarvam `POST https://api.sarvam.ai/speech-to-text` as multipart form data. Header `api-subscription-key`. Fields: `file`, `model=saaras:v4`, `mode=transcribe`.
- Put the transcript in the question box and run the same path as a typed question.
- Cap clips at 30 seconds. That is the REST limit. Show the transcript so a bad transcription can be edited and resent.

### Agent

Replace the single “always cluster” call with a loop in `lib/agent.js`, used when the user asks something or taps the mic. Gemini gets three tools:

| Tool | Does |
| --- | --- |
| `list_tabs` | Runs the phase 1 collector and returns titles, URLs, and excerpts |
| `search_memory` | Mem0 search for a query string |
| `save_trails` | Writes the trails the model just proposed into mem0 and into `chrome.storage.local` |

Loop at most four tool rounds, then require a final text answer. The side panel still has an explicit “Group my tabs” button that calls `list_tabs` and the phase 1 JSON prompt directly, so the demo does not depend on the model choosing the right tool.

The agent is the “behind the scenes” piece from the README. It runs only for a question or a voice command. Clustering on the button stays a straight structured call.

### UI pass

Only after the three integrations work on the rough panels:

- Side panel: trail cards (label, one-liner, tab count), the question box, the mic button, and a link to the graph.
- Graph page: trail color, the one-liner on the selected node, and an empty state when nothing has been saved.
- Options: three key fields and the mem0 user id. A “Test” button per key that hits a tiny request and shows ok or the error.
- Errors in the panel in one line: missing key, Sarvam failure, Gemini failure, tab that could not be read.

Done when the demo script below works without opening DevTools.

## Demo script

1. Options: paste the three keys. Each test button succeeds.
2. Open two clusters of tabs that a person can tell apart.
3. Open the side panel. Press “Group my tabs.” Two cards appear with one-liners.
4. Open the graph. Both trails are visible. Click a tab and Chrome focuses it.
5. Close the tabs.
6. Hold the mic and say “what was I just working on?” The transcript appears, then an answer that names both trails.
7. Type a narrower question about one trail. The answer uses memory, not the tabs, because the tabs are gone.

## Risks

- **Page text is the slow part.** Dozens of `executeScript` calls will stall the button. Batch them, time out a tab at a few seconds, and continue with title and URL.
- **Gemini will over-group or under-group.** The JSON schema and the “every tab once” rule matter more than prompt prose. If a run is wrong, show the raw groups anyway so the demo still moves.
- **Mem0 stores facts, not a graph.** The graph geometry (which tabs, which edges) stays in `chrome.storage.local`. Mem0 stores the sentences you ask about later.
- **Keys in an extension are extractable.** Acceptable for a hackathon build loaded unpacked. The options page is the only input. No keys in source.
- **Sarvam on a noisy room.** Always show the transcript before treating it as the command.

## Build order checklist

- [ ] Phase 1. Side panel lists LLM groups for the tabs that are open now.
- [ ] Phase 2. Graph page draws those groups and can focus a tab.
- [ ] Phase 3. A question still works after the tabs are closed.
- [ ] Phase 4. Push-to-talk runs that same question, the agent can call the three tools, and the panel is readable for the demo.
