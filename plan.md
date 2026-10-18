# Plan: Context for Humans

A Chrome extension that looks at open tabs, groups them into the projects you were actually working on, and keeps a memory of those trails so you can ask about them later.

The README’s order is the build order. Each phase is demoable on its own. Do not start a later phase until the earlier one works in the browser.

`test.py` (local Gemma) is a separate experiment. This plan does not use it. The extension calls Gemini Flash over the API.

## Product

You leave a pile of tabs and forget why they are open. Useful links currently get copied into Obsidian by hand. The extension should do that filing in the browser.

- Read every open tab (title, URL, and a short slice of page text).
- Group tabs into projects, and into a subfolder when the work splits.
- Attach one short line to each project, and a "why this link" note to a page when the title is not enough.
- Draw projects and their links as a memory graph.
- Remember projects, links, and intent after the tabs are gone, through [mem0](https://github.com/mem0ai/mem0).
- Answer timeline questions such as "what was I looking at last week about xyz".
- Take a spoken command through Sarvam speech-to-text and answer from that memory.
- Use a small agent loop when a question or a command needs tools. A single prompt that always does the same thing is not enough.

Projects come from three places:

1. The user says what they are working on, and the model files the open tabs under that project.
2. Nobody named a project, so the extension suggests groups. A suggestion stays a suggestion until the user accepts it.
3. The user creates a project, or moves a tab onto one, from the panel.

A person with two lookalike piles of tabs must be able to move a tab to the other project. Power users who already name projects carefully should not get a second copy of a project they already have.

Two surfaces:

- **Side panel.** Suggested groups, filed projects, a text box, and a push-to-talk button.
- **Graph page.** Projects and their links. A child project sits under its parent. A suggested group that is not filed yet is one inbox node.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Extension | Manifest V3, plain JS, no framework | Smallest thing that can read tabs and render HTML |
| Tabs | `chrome.tabs` + `chrome.scripting` | Title and URL are free. Page text needs a script injected into the tab |
| LLM | Gemini Flash, model `gemini-3.5-flash` | Extension calls. If the key rejects that id, use `gemini-flash-latest`. The memory dump names Gemma 4 for reading a stated intent. That call uses the same Gemini client in this build. `test.py` stays a local Gemma experiment |
| Structure | `chrome.storage.local` | Which link sits in which project. Mem0 rewrites sentences and returns them a few seconds later, so it cannot be the notebook |
| Memory | Mem0 Platform (`https://api.mem0.ai`, v3) | Recall. `memory/try_mem0.py` already added a trail and searched it back with `mem0ai` 2.2.1 |
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
- Mem0 open-source self-hosting, and any graph database of our own. Platform graph memory is a retrieval boost. The drawing is still our SVG.
- A timeline view that regroups the graph by week. Timeline questions are in. A time-axis UI is later.
- An intent rollup job that rewrites old intent notes into one summary. Intent notes are stored as they happen.
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

`memory/try_mem0.py` is the standalone probe. It is not part of the extension.

## Memory architecture

Three axes, two stores.

| Axis | What it is | Where it lives |
| --- | --- | --- |
| Project | A named body of work, with optional subfolders | Local record is the membership. Mem0 stores a project sentence and a link sentence per saved page |
| Timeline | When a page was filed, so "last week" can be asked later | The date inside the Mem0 sentence, the `timestamp` on `add`, and a `created_at` / `timestamp` filter on search |
| Intent | Why the work is happening, across the links of a project | A Mem0 sentence with `kind: "intent"`. The current one-liner is also on the local project |

Mem0 extracts facts. One sentence in the probe became three facts, a few seconds after `add` returned `{ "status": "PENDING", "event_id": "..." }`. Metadata on the `add` call was copied onto each fact. Search for "speech to text" returned the KrowdKraft facts. The other trail stayed out of the top hits.

So:

- The local record is the Obsidian notebook: project ids, parent ids, URLs, titles, and the note about why the link matters. Dragging a tab updates this record immediately.
- Mem0 is what you ask. It keeps the history of those notes after the tabs are closed. Moving a tab writes a new link memory under the new project. The older memory stays, which is the timeline of the move.
- A suggested group is not written to Mem0. Accepted groups, named projects, manual files, and spoken "I'm working on X" are written.

### Scope

Every Platform call uses:

- `user_id`: the options value, default `local-user`.
- `app_id`: `krowdkraft`, so this extension does not mix with other apps on the same key.

`agent_id` stays unset on these writes. A memory is attributed to the user or the agent, and a filter that requires both misses the user facts. `run_id` stays unset. A session is not a scope. Putting a session there would hide "last week" unless every search wildcards it.

`add` sends entity ids at the top level. `search` and `get_all` send them inside `filters`. The probe's client posts to `/v3/memories/add/` and `/v3/memories/search/`.

### Local record

```json
{
  "projects": [
    {
      "id": "prj_krowdkraft",
      "name": "KrowdKraft",
      "parent_id": null,
      "intent": "A Chrome extension that files tabs into projects.",
      "created_at": "2026-10-18T00:00:00Z",
      "updated_at": "2026-10-18T00:00:00Z"
    }
  ],
  "links": [
    {
      "id": "lnk_mem0_docs",
      "project_id": "prj_krowdkraft",
      "url": "https://docs.mem0.ai",
      "title": "mem0 docs",
      "note": "How add and search work.",
      "tab_id": 12,
      "saved_at": "2026-10-18T00:00:00Z"
    }
  ]
}
```

A subfolder is a project with `parent_id` set. Links with `project_id: null` are the inbox of suggestions. Matching an existing project name is a local lookup first. Mem0 search is only a hint. A second project of the same name is created only after the user confirms.

The SVG graph reads this record. Nodes are projects. Smaller nodes are links. A child project sits under its parent.

### Mem0 memories

`infer` stays on. The sentence is the memory. Metadata is a flat string map, which is all the Platform metadata filter accepts. Page bodies stay out.

| `kind` | When it is written | Sentence |
| --- | --- | --- |
| `project` | A project is created, or its intent line changes | "The user has a project named KrowdKraft. Intent: a Chrome extension that files tabs into projects so a closed page can still be found." |
| `link` | A page is filed, by accept, by voice, or by a move | "On 2026-10-18, in project KrowdKraft, the user saved mem0 docs (https://docs.mem0.ai) because it documents add and search." |
| `intent` | The user states what the work is for, or an accepted group has a one-liner about why | "On 2026-10-18 the user's intent in project KrowdKraft was to file tabs without pasting them into Obsidian." |

Metadata on every call:

```json
{
  "kind": "link",
  "project_id": "prj_krowdkraft",
  "project_name": "KrowdKraft",
  "parent_project_id": "",
  "url": "https://docs.mem0.ai",
  "saved_at": "2026-10-18"
}
```

`url` is empty on a project or intent memory. `parent_project_id` is empty on a top-level project. The sentence also names the parent path (`KrowdKraft / Mem0`) so a question about the parent can still hit a child link.

`timestamp` on `add` is the Unix seconds of `saved_at`, so a late write still sits on the day the page was filed.

Categories are inferred by Mem0 and are not the membership key. `metadata.kind` and `metadata.project_id` are.

### How a question is answered

1. Turn a time phrase into a range. "Last week" is a local date calculation. A month name is the same. No model call for that.
2. If the question names a project, resolve it in the local record, including child project ids.
3. `search` the topic text with filters:

```json
{
  "AND": [
    { "user_id": "local-user" },
    { "app_id": "krowdkraft" },
    { "timestamp": { "gte": "2026-10-11T00:00:00Z", "lt": "2026-10-18T00:00:00Z" } },
    { "metadata": { "project_id": "prj_krowdkraft" } }
  ]
}
```

Several projects are an `OR` of `metadata.project_id` clauses nested inside that `AND`. A sibling `OR` next to `AND` is dropped by the API. Omit the project clause when the question does not name one. Omit the timestamp clause when it does not name a time.

4. Gemini answers from the returned facts. The panel lists the `project_name` values those facts carried.

`keywords` is a `get_all` filter. On `search` it currently returns a 500, so the topic goes in the query string.

### What each gesture writes

| Gesture | Local record | Mem0 |
| --- | --- | --- |
| "Group my tabs" with no project named | Suggested groups in the inbox | Nothing |
| User accepts a suggestion, or says "file these under KrowdKraft" | Create the project if needed, file the links, set `intent` | One `project` memory if new or the intent changed, one `intent` memory, one `link` memory per page |
| User creates a project or moves a tab | Update ids immediately | One `link` memory for the new filing. A brand-new project also gets a `project` memory |
| "What was I looking at last week about xyz?" | Used to expand a project name to child ids | Search, then Gemini |

Deleting a project removes it from the local record. Its Mem0 facts stay, so the old week can still be asked about.

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
6. Store the last result in `chrome.storage.local` so the panel survives a reload. These are suggestions in the inbox (`project_id` null). This phase does not call Mem0. An accepted suggestion becomes a project in phase 3.

Done when: with two obvious projects open (for example a hackathon repo and a recipe), one click produces two trails and the one-liners match what is on screen.

## Phase 2 — Graph page, mock data first

Goal: an extension page that draws a graph. Real tab data comes after the drawing works. This phase draws suggestions. Once phase 3 files projects, the same page reads the local project record.

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

Goal: accept a suggestion into a project, close the tabs, and get the project back from Mem0.

`lib/memory.js` is the only Mem0 caller. It follows the schema above: `user_id`, `app_id: "krowdkraft"`, v3 `add` and `search`, flat metadata, date in the sentence, `timestamp` set from `saved_at`. The key comes from the options page.

1. An Accept control on a suggestion creates the project and its links in the local record, then writes one `project` memory, one `intent` memory, and one `link` memory per page. `add` returns `PENDING`. The panel can keep working. Search is what shows the facts have landed.
2. The question box parses a time phrase locally, resolves a project name to that id plus its children, searches, and sends the facts to Gemini. The answer shows the `project_name` values that came back.
3. A “What was I working on?” button lists projects from the local record. If that record is empty, it searches `metadata.kind = "project"`.

Page excerpts stay in the phase 1 prompt and are discarded. Titles, URLs, the intent line, and the link note are the memory.

Done when: accept two suggestions, close those tabs, reload Chrome, ask “what was I looking up about speech to text?”, and the answer names the project. Asking the same thing “today” still finds it, because the timestamp filter is applied.

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
| `search_memory` | Mem0 search with the question, plus a project id and a time range when the question has them |
| `file_links` | Files pages under a named project in the local record and writes the `project`, `intent`, and `link` memories |

Loop at most four tool rounds, then require a final text answer. The side panel still has an explicit “Group my tabs” button that calls `list_tabs` and the phase 1 JSON prompt directly, so the demo does not depend on the model choosing the right tool.

The agent is the “behind the scenes” piece from the README. It runs only for a question or a voice command. Clustering on the button stays a straight structured call.

### UI pass

Only after the three integrations work on the rough panels:

- Side panel: suggestion cards with Accept, filed project cards (name, intent, link count), the question box, the mic button, and a link to the graph. Right-click a link to move it to another project. The local record updates first, then one new `link` memory is written.
- Graph page: project color, the intent line on the selected node, child projects under their parent, and an empty state when nothing has been filed.
- Options: three key fields and the mem0 user id. A “Test” button per key that hits a tiny request and shows ok or the error.
- Errors in the panel in one line: missing key, Sarvam failure, Gemini failure, tab that could not be read.

Done when the demo script below works without opening DevTools.

## Demo script

1. Options: paste the three keys. Each test button succeeds.
2. Open two clusters of tabs that a person can tell apart.
3. Open the side panel. Press “Group my tabs.” Two suggestion cards appear with one-liners.
4. Accept each card into its own project. Open the graph. Both projects and their links are visible. Click a link and Chrome focuses that tab.
5. Close the tabs.
6. Hold the mic and say “what was I just working on?” The transcript appears, then an answer that names both projects.
7. Type “what was I looking up about speech to text today?” The answer uses memory, because the tabs are gone.

## Risks

- **Page text is the slow part.** Dozens of `executeScript` calls will stall the button. Batch them, time out a tab at a few seconds, and continue with title and URL.
- **Gemini will over-group or under-group.** The JSON schema and the “every tab once” rule matter more than prompt prose. If a run is wrong, show the raw groups anyway so the demo still moves.
- **Mem0 is slow and lossy on purpose.** `add` returns `PENDING`, then one sentence becomes several facts. Membership stays in the local record. Only an accepted filing is written, so a rejected suggestion cannot appear in a later answer. Metadata values are strings. The topic stays in the query string, because a `keywords` filter on `search` returns 500. An `OR` sits inside `AND`, because a sibling `OR` is dropped.
- **Keys in an extension are extractable.** Acceptable for a hackathon build loaded unpacked. The options page is the only input. No keys in source.
- **Sarvam on a noisy room.** Always show the transcript before treating it as the command.

## Build order checklist

- [ ] Phase 1. Side panel lists LLM groups for the tabs that are open now.
- [ ] Phase 2. Graph page draws those groups and can focus a tab.
- [ ] Phase 3. An accepted project can still be asked about after the tabs are closed, including a “today” timestamp filter.
- [ ] Phase 4. Push-to-talk runs that same question, the agent can list tabs, search memory, and file links, and a link can be moved to another project.
