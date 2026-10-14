# OMNI AI

A single workspace for AI chat, agents, productivity, research, knowledge, code, and automation.
Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Prisma, and PostgreSQL.

## Status

This repository is at **Part 4 (in progress): the agent framework is done; memory, knowledge, research, calendar, automation, coding, documents, and integrations are not**. See `PROJECT_PROGRESS.md` for the full list.

| Area | Status |
| --- | --- |
| App shell, routing for all 15 sections, themes, command palette, shortcuts | Done (Part 1) |
| OpenRouter API key settings (encrypted at rest, environment fallback, connection test) | Done |
| Model catalog (live from OpenRouter, cached, search, free/paid and capability filters, favorites, default model) | Done |
| Streaming chat (stop, regenerate, retry, model switching, system instructions, rename, delete) | Done |
| Persistent conversations and messages (PostgreSQL via Prisma) | Done |
| Usage tracking (tokens, cost, 30-day breakdown), monthly spending limit | Done |
| Optional password sign-in (off by default), cross-site protection, rate limiting, audit log | Done (see Security) |
| Chat: editing and branching, image and document attachments, code highlighting, export, summaries, model comparison | Done |
| Chat tool calling and JSON mode | Not started (use Agents for tools) |
| Knowledge base (PDF, Word, Excel, CSV, Markdown, text, code, images; hybrid search; citations in chat) and memory | Done |
| Tasks (priorities, due dates, subtasks, tags, search, filters, sorting, Kanban board) | Done (Part 3) |
| Notes (Markdown, autosave, folders, tags, search, pinning) | Done (Part 3) |
| Projects (status, milestones, progress dashboards, linked tasks) | Done (Part 3) |
| AI integration (break a project into tasks, project plans, note summaries, task priorities, organize tasks and notes), always confirm-before-apply | Done (Part 3) |
| Agents (builder, run engine, tool registry, approvals, limits, cancellation, bounded delegation, run history) | Done (Part 4, first phase) |
| Calendar: month/week/agenda views, repeating events, tasks and milestones overlay, .ics import/export, AI time blocking | Done (Google Calendar sync needs OAuth; see Calendar) |
| Automations: visual step flows, schedule/event/webhook triggers, run history | Done |
| Research: web search provider, page reading, cited reports | Done (needs a search provider key) |
| Integrations: GitHub, Notion, Todoist, Slack, Discord, Google (Gmail, Calendar, Drive) with confirmations, agent tools, and an automation step | Done, **not tested against the live services** (see Integrations) |
| Documents: draft documents, slides and spreadsheets with AI; export to PDF, Word, PowerPoint, Excel, Markdown, text, CSV; exports from notes, tasks, projects and research | Done |
| Code workspace: Monaco editor, projects and files, AI explain/review/edit/tests with diffs, Docker-sandboxed Run | Done (Run needs Docker; not verified here) |
| Desktop apps (Mac, Windows; each with its own built-in database) and an Android app that connects to your server; built by GitHub Actions into Releases | Mac app built and run here; **Windows and Android builds are untested** (see Apps) |
| Analytics: tasks finished, time scheduled, AI spend by day and model, activity, with 7/30/90 day ranges | Done |

## Requirements

- Node.js 22.18+, 24.11+, or 26 (developed on Node 26)
- PostgreSQL 14+ (developed on 16)
- Google Chrome, only for the browser end-to-end tests

## Setup

```bash
npm install                       # also runs `prisma generate`

createdb omni_ai                  # or create the database with any Postgres client
cp .env.example .env              # then edit .env
```

Edit `.env`:

- `DATABASE_URL`: your PostgreSQL connection string.
- `ENCRYPTION_KEY`: generate one with `openssl rand -base64 32`. It encrypts the OpenRouter key before it is stored. Keep it safe: if it changes, saved keys can't be decrypted and you'll need to enter the key again.

Apply the database migrations and start the app:

```bash
npm run db:migrate                # applies prisma/migrations to DATABASE_URL
npm run dev                       # http://127.0.0.1:3000
```

Then open **Settings**, paste your OpenRouter key, click **Save key**, and **Test connection**. Get a key at https://openrouter.ai/keys.

You can instead set `OPENROUTER_API_KEY` in `.env`. The environment key is used when no key is saved in Settings, and the Settings page shows which source is active.

### Running in Docker

```bash
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env     # skip if you already have a .env
docker compose up --build                                     # http://localhost:3000
```

This starts PostgreSQL 16 and the app, applies migrations on start, and publishes the app on this computer only. **The Docker files were written but not run on the machine this was built on (Docker wasn't installed there), so treat the first build as untested.** The code workspace's Run button needs access to Docker itself, which the compose file does not grant; it shows as unavailable inside the container.

## OpenRouter configuration

- **Base URL:** `https://openrouter.ai/api/v1`. Override it with `OPENROUTER_BASE_URL`, for example to point at a proxy.
- **Model catalog:** fetched from `GET /models` (text output models) and cached in memory for 15 minutes. Use **Refresh catalog** in Settings to force an update.
- **Usage and cost:** requests use OpenRouter's streamed usage report. When OpenRouter reports a cost, the app records it. When it doesn't, the app estimates cost from the catalog's published per-token prices and labels the figure "est.". When neither is available, the cost is recorded as unknown and excluded from totals.
- **Error handling:** authentication, payment, rate-limit, moderation, timeout, network, and provider failures each show a specific message. Failures that happen mid-reply keep the partial text.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on 127.0.0.1:3000 |
| `npm run build` | Generate the Prisma client and create a production build |
| `npm start` | Serve the production build on 127.0.0.1:3000 |
| `npm run db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:studio` | Open Prisma Studio to inspect data |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emitting files |
| `npm test` | Unit and component tests (Vitest, no database needed) |
| `npm run test:integration` | Chat, task, note, project, AI, and agent service tests against a real Postgres database (see below) |
| `npm run test:e2e` | Full browser suite: builds the app, starts a mock OpenRouter server, runs the smoke, chat, productivity, and agent tests |

### Integration tests

`npm run test:integration` runs the chat, task, note, project, AI, and agent services against a real database, with only the OpenRouter HTTP calls mocked. Create a test database first:

```bash
createdb omni_ai_test
```

The script applies migrations to `TEST_DATABASE_URL` (default `postgresql://USER@localhost:5432/omni_ai_test`) and then runs the tests. Both the tests and the data-clearing helper refuse to run against a database whose name doesn't end in `_test` or `_e2e`.

### End-to-end tests

`npm run test:e2e` needs Google Chrome installed. It uses `E2E_DATABASE_URL` (default `.../omni_ai_e2e`), clears that database's tables, builds the app, and runs:

- `e2e/smoke.mjs`: shell, routing, themes, responsive layout, and the 404 page.
- `e2e/chat.mjs`: saving and testing a key (valid and invalid), the model picker, streaming, stop, mid-stream errors, persistence across reloads, renaming, the spending limit, usage totals, and deletion.
- `e2e/agents.mjs`: the agent builder and its validation, built-in agents being read-only, a read-only run, writes that wait for approval (and the data being untouched until approved or after a decline), the step limit, cancelling a stalled run, delegation, partial edits, deletion, the missing-key error, and phone-width layout.
- `e2e/productivity.mjs`: tasks (create, validate, subtasks, filter, search, sort, board drag-and-drop, delete), notes (autosave, reload persistence, Markdown preview, folders, tags, pinning, search), projects (milestones, progress, deletion), every AI action including that nothing is saved before confirmation, usage recording, the missing-key and spending-limit errors, and a phone-width layout check.

The mock OpenRouter server in `e2e/mock-openrouter.mjs` follows the documented request and response formats. For the planning assistant it returns JSON built from the ids in the prompt, so the AI flows run against real records. It is not the live OpenRouter service, and it does not show how a particular real model behaves with the JSON prompts. To check against the live API, run the app with a real key and try a message.

## Chat features

- **Edit and branch.** Hover over a message you sent and choose **Edit**. The new version replaces it on screen, later messages drop away from that branch, and nothing is deleted: step between versions with the ‹ 2/3 › control. **Regenerate** keeps the earlier reply the same way. Conversations from before this feature were migrated into a straight line of messages.
- **Attachments.** The paperclip attaches up to five files per message: images (PNG, JPEG, WebP, GIF, up to 5 MB) go to the model as images, and PDF, Word, Excel, CSV, Markdown, text, and code files (up to 10 MB) are read to text and given to the model as data. A model the catalog lists as text-only refuses images with a clear message. Files are stored in your database and served only to a signed-in browser (images inline, everything else as a download, with a sandbox policy).
- **Code.** Code blocks are syntax highlighted, labelled with their language, and have a copy button.
- **Export.** More → Export saves the version you're viewing as Markdown, plain text, or JSON.
- **Summarize.** More → Summarize this chat asks the model for a summary, key points, and action items. Saving it as a note, or adding action items as tasks, happens only when you click.
- **Compare models.** More → Compare models sends one prompt to two to four models at once and shows their answers side by side with time, tokens, and cost. These runs count toward usage but aren't saved as chats.
- **Model capabilities** (images, tools, reasoning, context size) come from OpenRouter's catalog and are shown in the model picker and on the compare page.
- Not built: calling tools from inside a chat. Agents are where tools live.

## Tasks, notes, and projects

- **Tasks** (`/tasks`): create, edit, complete, and delete tasks with a priority (low to urgent), due date, tags, a project and milestone, and one level of subtasks. Search (title, description, tags, subtask titles), filter by status, priority, project, tag, or due date (overdue, today, next 7 days, none), and sort by manual order, due date, priority, newest, recently updated, or title. The **Board** view has To do, In progress, and Done columns. Drag a card to move or reorder it, or use the card's "move" menu, which also works on touch screens and with a keyboard.
- **Notes** (`/notes`): Markdown notes with Write, Preview, and Split modes. Title, text, and tags **autosave** shortly after you stop typing. The status line shows saving and failures, a failed save keeps your text and offers Retry, and the browser warns before you leave with unsaved changes. Organize with folders, tags, pinning, and search. Raw HTML in notes is not rendered.
- **Projects** (`/projects`): projects have a description, status (planning, active, on hold, completed, archived), and an optional due date. Each project's dashboard shows progress (done tasks as a share of its top-level tasks), overdue tasks, milestones with their own task progress, and its linked tasks. Deleting a project keeps its tasks (they become unassigned) and removes its milestones. Deleting a milestone keeps its tasks.

### AI assistance

The assistant uses the same OpenRouter key, default model, spending limit, and usage tracking as chat. It needs a saved or environment key and a default model (Settings or AI Chat), and shows a link to Settings when either is missing.

| Where | Action | What it proposes |
| --- | --- | --- |
| Project dashboard | Break into tasks | New tasks (with priorities, optional dates, tags, and subtasks) |
| Project dashboard | Generate plan | Milestones plus tasks assigned to them |
| Note editor | Summarize | A summary, key points, and suggested tags to insert at the top of the note |
| Tasks | Suggest priorities | Priority changes for open tasks, each with a reason |
| Tasks | Organize | Moving tasks into existing projects and adding tags |
| Notes | Organize | Filing notes into folders (existing or new) and adding tags |

**Nothing is saved until you confirm.** Each action first shows a review dialog; every item has a checkbox, and only ticked items are sent to `POST /api/ai/apply` (the summary is inserted into the note after you edit or accept it). Discarding saves nothing. Model output is treated as untrusted: ids must match real records, priorities, dates, and tags are validated, duplicates and no-op changes are dropped, and applying the same plan twice does not create duplicate tasks. Note, task, and project text is passed to the model inside `<data>` blocks with instructions to treat it as data.

The model is asked for JSON and the reply is validated; if it isn't usable you see a specific error and can retry (the attempt still appears in usage). Each AI request is recorded in usage like a chat reply.

## Agents

`/agents` lists the agents, lets you build your own, and runs them. A run is an objective plus an agent; the agent works one action at a time, using the tools it was given, until it answers or hits a limit.

- **How a run works.** Each step the model returns one JSON object: a tool call or a final answer. The tool runs against your real tasks, notes, and projects and the result is fed back. Because the protocol is plain JSON through the existing OpenRouter client, it works with any model, whether or not that model supports native tool calling. Unusable replies and failing tools are reported back to the model so it can correct itself (three unusable replies in a row end the run), and rate-limit, timeout, and provider errors are retried.
- **Approvals.** Tools that change data (`create_task`, `update_task`, `create_note`, `append_to_note`, `create_project`, `add_milestone`) are set to **ask first** by default. The run pauses with the exact arguments shown, and nothing happens until you approve; declining tells the agent so. You can turn approval off per tool in the agent builder.
- **Limits.** Every run has a step limit (default 10, max 30), a spending limit (default $0.25, max $5) measured from OpenRouter's reported cost, and a 10-minute time limit, and it also respects your monthly limit. Cancel stops a run, including anything it delegated, and aborts the model request in flight. If a model has no known price, its calls count as unknown cost, so the step and time limits are what bound that run.
- **Delegation.** An agent with the `delegate` tool can hand a sub-task to another agent. Delegation is at most two levels deep, an agent can't delegate to itself, a delegated agent gets only the budget its parent has left, and its cost is rolled into the parent. Delegated agents can't use actions that need approval (there is nobody to ask mid-delegation); they are told so and can report what they couldn't do.
- **Persistence and recovery.** Runs, steps, and costs are stored in PostgreSQL. A run that was working when the server stopped resumes on the next visit. A tool that was mid-flight is never repeated: the agent is told it may or may not have completed. Runs waiting for approval stay paused.
- **Prompt injection.** Tool results and your workspace text go to the model inside `<data>` blocks with instructions to treat them as information, and the agent can only use tools you enabled. The main protection is that consequential actions need approval.
- **Built-in agents:** General Assistant, Project Manager, Study Assistant, and Writing Agent. They are read-only; duplicate one to customize it. The Research, Coding, Email, Calendar, Document Analyst, Data Analyst, and Automation agents will be added together with the tools they need, rather than shipped without them.

## Integrations

The **Integrations** page connects other services. A connection is only shown as connected after the service itself accepts the credential, credentials are stored encrypted (AES-256-GCM with your `ENCRYPTION_KEY`) and never returned to the browser, and disconnecting deletes them.

| Service | How you connect | What Omni can do |
| --- | --- | --- |
| GitHub | Personal access token | List your repositories and issues; open an issue; comment |
| Notion | Internal integration secret | Search pages; create a page under one you've shared |
| Todoist | API token | List tasks; add a task; complete a task |
| Slack | Incoming webhook address | Post a message (Slack can't check a webhook without posting, so it's shown as *not verified* until you send one) |
| Discord | Webhook address | Post a message (checked with a harmless read when you connect) |
| Google | Sign in with Google (OAuth, PKCE) | List recent email (sender, subject, preview, never the body); save an email **draft** (never send); list and import calendar events; search Drive; add a Google Doc or text file to Knowledge |

- **Anything that changes something outside Omni asks first.** On the page, writing shows a dialog with exactly what will be sent and waits for your click, and the server refuses a write that wasn't confirmed. For agents, every write is a tool that pauses for your approval by default. **There is no tool or button that sends email or runs code**; the Email Agent can only leave drafts in Gmail for you to read and send. Messages posted to Slack have `<`, `>`, `&` escaped so they can't ping `@channel`, and Discord messages can't mention anyone.
- **Read results are untrusted.** Email, issues, and pages are written by other people; they're given to agents labelled as information, never as instructions. Gmail messages are read as metadata only.
- **Automations** can use any action through the *Use a connected service* step. That is a standing instruction you wrote and switched on, so it runs unattended; the editor says so on every write action.
- **Google needs an OAuth client that only you can create** (Google requires an app you control). Create an *OAuth client ID* (type *Web application*) in the Google Cloud console, enable the Gmail, Calendar, and Drive APIs, add the redirect address the Integrations page shows you, and put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (and `OMNI_PUBLIC_URL` if the app is reached at a different address than the one in your browser). You choose at connect time between *read only* and *read plus email drafts*. Tokens are refreshed automatically.
- **What was and wasn't tested.** I had no accounts or credentials for any of these services. Everything is tested against stand-in servers that follow each service's documented request format, including the whole Google sign-in (PKCE, one-time state, token exchange and refresh) and every write confirmation. None of it has talked to the real GitHub, Notion, Todoist, Slack, Discord, or Google, so a difference between the documentation and the live service could still show up on first use; errors are reported in plain words when it does. Todoist's REST address is configurable (`TODOIST_API_URL`) in case Todoist moves it.

## Documents

The **Documents** page drafts a document, a slide deck, or a spreadsheet from a description (optionally based on one of your notes), shows it for review, and downloads it as a real file.

- **Formats:** documents as PDF, Word (`.docx`), Markdown, or text; slide decks as PowerPoint (`.pptx`), PDF, or Markdown; spreadsheets as Excel (`.xlsx`) or CSV. Every format is generated by Omni itself from a structured draft (headings, paragraphs, lists, tables, code), with no cloud service involved. The tests open each generated file again with an independent reader (a PDF text extractor, a Word reader, a spreadsheet reader, and a zip reader for PowerPoint) to check that the content is really in there.
- **Edit before you download.** A document draft is shown as editable Markdown with a live preview; what you see is what the file contains. Slides and spreadsheets are shown as drafted; ask again with a better description to change them. You can also click *Write it myself* and use it as a plain Markdown-to-PDF/Word converter without any AI.
- **Export what you already have:** the **Export** menu on a note (PDF, Word, Markdown, text), a **Report** menu on a project (status, progress, milestones, and tasks), **Export** on the Tasks page (Excel or CSV), and the Export menu on a research report (with its source list).
- **Limits you should know about.** PDF export uses the standard PDF fonts, which cover Western European languages; other scripts and emoji become `?` in the PDF, and the page tells you how many (Word and Markdown keep them). Images in notes aren't included. A document can have up to 600 blocks, a deck 40 slides, and a spreadsheet 10 sheets of 5,000 rows.
- **Safe spreadsheets.** Text that begins with `=`, `+`, `-`, or `@` is saved as text (CSV adds an apostrophe), so a draft or a note can't smuggle a spreadsheet formula into your file.
- **AI drafts are drafts.** The model is told not to invent facts, figures, or sources, but it can; read before you use it. Your request and the note are fenced as data, so instructions inside a note can't override the rules.

## Code workspace

A place to write and edit code, with an assistant that proposes changes you review.

- **Projects and files** are stored in your database (up to 200 files of 500 KB each per project, plain text only). The editor is Monaco, the editor behind VS Code, served by this app itself rather than a CDN. Files autosave, and names can't climb out of the project (`..`, absolute paths, spaces, and shell characters are refused).
- **The assistant** can explain a file, review it for problems, make a change you describe, or write tests. A change comes back as a **diff**; nothing in your files changes until you press *Apply*, and written tests are offered as a new file whose name you choose. Your file is sent to your default model, fenced as data so instructions inside it can't override the rules.
- **Run** starts the selected `.js`/`.mjs`/`.cjs` or `.py` file in a **Docker container**: no network, read-only file system, all Linux capabilities dropped, no privilege escalation, a non-root user, 256 MB of memory, 64 processes, one CPU, a 15-second limit, and 64 KB of captured output. Only that project's files are copied in, and the docker program never sees this app's environment (database URL, keys). If Docker isn't installed or running, **Run is disabled and says so; there is no fallback that runs code on your computer.** Only a person pressing Run starts a run: agents and automations have no way to run code.
- **Not verified on the machine this was built on:** it had no Docker, so the container itself was never started. The command Omni builds, the timeout and kill-by-name handling, the output cap, the clean environment, and the "Docker missing" behavior are tested against a stand-in `docker` program; the first real run on your machine is the real test. Settings: `CODE_SANDBOX_NODE_IMAGE`, `CODE_SANDBOX_PYTHON_IMAGE`, `CODE_RUN_TIMEOUT_MS`, `CODE_DOCKER_BIN`.
- **Agents.** `list_code_files` and `read_code_file` read; `write_code_file` changes files, so it asks for approval. The built-in **Coding Agent** uses them and has no run tool.
- Not built: a terminal, git, language servers beyond what Monaco includes, and running languages other than JavaScript and Python.

## Research

Ask a question on the Research page and Omni plans a few searches, runs them through the web search service you choose, **reads the actual pages**, and writes a Markdown report where each claim ends with the number of the source behind it.

- **You choose the search service** in Settings → Web search (or right on the Research page the first time): **Brave Search** or **Tavily** (each needs an API key; both have free plans) or your own **SearXNG** instance (needs its address and JSON output enabled). Keys are encrypted at rest and never shown again, only their last four characters. Without one, Research tells you exactly what's missing and doesn't run.
- **Sources are never invented.** The only sources are results the search service returned, with tracking parameters removed and duplicates merged. After the model writes, every citation number is checked against the sources it was actually given; numbers that don't match are removed. Each source shows whether its page was read or only its search snippet was available, why a page couldn't be read, and whether the report actually cited it.
- **Safe page reading.** Pages are fetched only over http(s), at most 1.5 MB each, never from your own machine or network (checked again at every redirect), and PDFs and non-pages are reported as unreadable rather than guessed at. Page text is passed to the model fenced as source material with instructions to treat it as information, never as orders.
- **Cost.** A run is one small planning call and one report call to your default model, plus the search requests. *Quick* reads up to four pages, *Thorough* up to eight.
- **Keeping results.** Reports are saved and listed. From a report you can copy it as Markdown, save it as a note, or add it to Knowledge so chat can use it. Stop keeps what was written so far.
- **Agents.** `web_search` and `read_webpage` are read tools; the built-in **Research Agent** uses them. An agent can only open an address that a search returned in the same run, or that you typed in the objective, so a hostile page can't make it fetch an attacker's address with your data in the URL.
- Not built: reading PDFs found on the web, and searching behind logins. The search request itself (your query) goes to the provider you chose.

## Automations

An automation is one **trigger** and an ordered list of **steps**. It is built on the Automations page as a vertical flow; each step can use what the trigger and earlier steps produced through `{{placeholders}}` such as `{{trigger.title}}`, `{{steps.2.output}}`, and `{{today}}`. Placeholders are filled in as plain text; nothing in them is ever run as code.

- **Triggers:** run it yourself; on a schedule (every N minutes, daily, or on chosen weekdays, at a local time in a time zone you choose, with daylight saving handled); when a task is created or completed; when a note is created; when a document is added to Knowledge; or when a private web address is called (a webhook).
- **Steps:** look up tasks, look up calendar events, ask the AI (your default model; billed and counted in usage like chat), create a task, create a note, add a calendar event, call a web address, and *only continue if…* (stops quietly when a condition is false).
- **Starts switched off.** Nothing runs on a schedule or a trigger until you switch it on, and an automation with no steps can't be switched on.
- **Run history** shows every run, and for each step what it was given and what it produced. A failing step stops the run, says why in plain words, and skips what follows. Runs interrupted by a restart are marked failed rather than left "running".
- **Webhooks.** Create an address on a webhook automation and copy it; for safety it is shown once and only its hash is stored, so a lost address means making a new one (the old one stops working). Switched-off or unknown addresses all answer `404`. Anyone with the address can start the automation, so treat it like a password. The JSON you send is available as `{{trigger.fieldName}}`, and the raw body as `{{trigger.body}}`.
- **Calling web addresses** is limited to http and https and **blocks addresses on your own machine and network** (including localhost, private ranges, and cloud metadata addresses), checking again on every redirect. Set `AUTOMATION_ALLOW_PRIVATE_HOSTS=1` to allow them deliberately, for example to reach a service on your LAN. Header values (such as an API token) are saved in your database and masked in run history. DNS can change between the check and the request, so don't rely on this to defend against a hostile DNS server you don't control.
- **Loops can't form.** What an automation does never starts another automation, and one automation can run at most 60 times an hour.
- **The scheduler** runs inside the app's server process and checks every 20 seconds, so schedules only fire while the server is running. Runs missed while it was off are skipped, not replayed. Set `OMNI_DISABLE_SCHEDULER=1` to turn it off (for example on a second instance sharing a database).

## Calendar

- **Events.** Month, week, and agenda views. Click a day (or an hour in the week view) to add an event; click an event to edit or delete it. Tasks with due dates and project milestones appear on their dates as dashed and flagged chips, and link to their pages. Today's events show on the home page.
- **Repeats** (daily, weekly on chosen days, monthly, yearly; every N; ending never, on a date, or after N times) keep the same clock time in the event's time zone through daylight-saving changes. Editing or deleting a repeating event asks whether it's *only this one* or *the whole series*. A month without the date (the 31st) is skipped, as in iCalendar.
- **Import and export** use standard `.ics` files, so you can move events to and from Google Calendar, Apple Calendar, and Outlook by file. Re-importing the same file updates events instead of duplicating them. Repeat rules Omni can't represent (for example "first Monday of the month") are imported as a single event, with a warning that says so.
- **Google Calendar sync is not built.** It needs a Google OAuth client, which only you can create. Import and export are the supported route until then.
- **Plan my tasks** asks the assistant to place open tasks in free time within your working hours. It sees your existing events and never overlaps them; you review the blocks and choose which to add. Blocks become events linked to their task. Applying the same plan twice doesn't duplicate anything.
- **Agents.** `list_events` reads the calendar; `create_event` writes, so it asks for approval by default. The built-in **Calendar Assistant** uses both.

## Knowledge base and memory

**Knowledge** (`/knowledge`) turns your files into something chat and agents can search, and shows where every answer came from.

- **Adding things.** Upload PDF, Word (`.docx`), Excel (`.xlsx`), CSV, Markdown, text, source code, or images (PNG, JPEG, WebP, GIF), paste text, or index your notes. Files up to 15 MB. Only the extracted text is kept; the original file is not stored. Scanned PDFs have no text to extract, so upload their pages as images instead. Image text comes from a model reading the picture, so it can contain mistakes, and the document says so.
- **How search works.** Text is split into pieces of about 1,000 characters, each remembering its page (PDF) or heading (Markdown). Each piece is turned into a vector with an OpenRouter embedding model (default `openai/text-embedding-3-small`, changeable through `PATCH /api/knowledge/settings`) and stored in PostgreSQL. A question is embedded the same way and compared by cosine similarity, with a small bonus for exact word matches. Anything below a relevance floor is dropped rather than shown as a weak match.
- **When embeddings aren't available** (no key, a failing model, a spent budget), documents are still saved and found by keyword, and the page tells you why meaning-based search is off. **Re-index** retries.
- **Scale.** Vectors live in ordinary columns and are compared in the server's memory, which is fine for personal use (tens of thousands of pieces). It is not pgvector; very large libraries would want that.
- **Citations in chat.** With the **Knowledge** toggle on, each message searches your documents, and the model is given the top passages as numbered sources and told to cite them as `[1]`. The sources are saved with the reply. Sources the reply cites are highlighted; the others are shown as retrieved but not cited. Text inside your documents is passed as data, not instructions, and tags in it are neutralized so it can't close the block it sits in.
- **Memory** is a list of facts you choose to keep ("I prefer metric units"). Relevant ones are sent along with your message while **Use memories in chat** is on; turn it off and none leave your database. Add them on the Memory tab, or choose **Remember this** under any message you sent. You can edit, search, export as JSON, or delete them all (a confirmation is required).
- **Agents.** `search_knowledge` and `search_memory` are read tools available to every agent; `remember` writes, so it asks for approval by default. The built-in **Document Analyst** answers from your documents and names the source.

## Analytics

Open **Analytics** for 7, 30, or 90 days of your own data: tasks created and finished per day (with median time to finish, and counts by priority and project), calendar hours versus hours set aside for tasks, AI spend and requests per day with a per-model table and the month against your limit, and activity counts (conversations, notes, documents, reports, agent and automation runs). Days follow your browser's time zone. Nothing is estimated: requests the provider didn't report a cost for are counted and called out rather than priced.

## Apps (Mac, Windows, Android)

Download them from the repository's **Releases** page.

- **Mac and Windows** are self-contained: the app starts its own PostgreSQL database and the OMNI server on your computer, and opens them in a window. Nothing to install first. Data lives in the app's data folder (`~/Library/Application Support/OMNI AI` on Mac, `%APPDATA%\OMNI AI` on Windows). Its random database password and encryption key are kept in `secrets.json` there, readable only by you. Sign-in is off, because only this computer can reach it.
- **Android** can't run a server or database, so the app opens an OMNI server that you run. Enter its address on first launch. Any PostgreSQL works as that server's `DATABASE_URL`, including a hosted one such as Supabase (use the direct or session connection, not the transaction pooler). If the server is reachable from the internet, serve it over https and set `OMNI_REQUIRE_LOGIN=1`. Exports (PDF, Word and so on) download in a browser; the app's web view can't save downloads yet.
- **Not signed.** See the release notes for the first-launch warnings on each system.
- **Not verified:** the Mac app was built and run on the machine this was developed on. The Windows and Android apps are built only by GitHub Actions and were never run by me, and the Mac build is Apple silicon only.

To build them yourself: `cd desktop && npm ci && npm run dist` (builds for the system you are on), and for Android `cd android && npm ci && npx cap sync android && cd android && ./gradlew assembleDebug` (needs Java 21 and the Android SDK). Pushing a tag such as `v0.1.0` makes GitHub build everything and publish a release.

## Command bar

**Ctrl/Cmd+K** opens the command bar. It searches pages and actions, and whatever you type is also offered as **Ask AI** (puts it in the chat box for you to send, nothing is sent for you), **Add task**, or **Add note**. These are fixed commands, not an AI guessing what you meant, so nothing happens that you didn't pick.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Open or close the command palette |
| `⌘B` / `Ctrl+B` | Collapse or expand the sidebar |
| `⌘,` / `Ctrl+,` | Open settings |
| `↑` / `↓`, `Enter`, `Esc` | Navigate, run, or close within the palette |
| `Enter` / `Shift+Enter` (chat) | Send / new line |

## Data and privacy

- **Stored in PostgreSQL:** settings (including the encrypted OpenRouter key, default model, favorites, and monthly limit), conversations, messages, one usage record per reply or AI request, tasks, projects, milestones, notes, note folders, agents, and agent runs with every step's tool input and output.
- **Stored in the browser:** the theme and sidebar state, in `localStorage`.
- **Sent to OpenRouter:** the conversation history for each chat request, plus any system instructions you set for that conversation. When you use an AI action, the relevant content is sent: the project's name, description, milestones, and task titles; the text of the note you summarize; titles, descriptions, due dates, and tags of up to 60 open tasks for priorities and organizing; and titles, short excerpts, folders, and tags of up to 60 notes for organizing. Notes are truncated to their first 24,000 characters for summaries. An agent run sends the objective, the agent's instructions, and the results of the tools it calls (task, note, and project content) to the model.
- **Knowledge and memory:** when you add a document or memory, its text is sent to the OpenRouter embedding model. Each chat message is embedded (when Knowledge or memory is on) and the best-matching passages and memories are sent with it.
- **Never returned to the browser:** the OpenRouter key. The Settings page shows only its last four characters.
- Deleting a conversation removes its messages. Its usage records are kept so totals stay accurate.
- Deleting a task removes its subtasks. Deleting a folder keeps its notes. Deleting a project or milestone keeps its tasks.

## Security

- **Sign-in is off by default**, which suits an app on your own computer (it listens on 127.0.0.1 only). Set `OMNI_REQUIRE_LOGIN=1` in `.env` and restart to require a password; do that before the app can be reached by anyone else. With it on:
- **Sign-in.** The first time you open the app it asks you to set a password. After that every page and every API route requires a session (a 30-day, HTTP-only cookie). Only a hash of the cookie token is stored in the database, and passwords are hashed with scrypt. Anyone who can reach the server before you set the password can claim it, so set it right away and don't expose a fresh install to a network.
- **Forgot the password?** There's no email reset. Run `TRUNCATE "AuthConfig", "AuthSession";` in your database, then open the app and set a new one.
- **Protection against forged requests.** Writes from another site are refused (the `Origin` header must match the host), and the cookie is `SameSite=Lax`.
- **Rate limits.** 8 wrong passwords per 15 minutes, 600 writes per minute, and 40 model-spending requests per minute. They live in memory, so they reset when the server restarts. `OMNI_API_RATE_LIMIT` and `OMNI_AI_RATE_LIMIT` change the write and model-spending limits. Behind a reverse proxy, set `TRUST_PROXY=1` so limits use the real client address from `X-Forwarded-For`.
- **Audit log.** Sign-ins, failures, lock-outs, sign-outs and password changes are recorded and shown in Settings. It never contains passwords or keys.
- The server still binds to `127.0.0.1` by default. If you put it behind HTTPS, the cookie is marked `Secure` automatically.
- Model output is rendered as Markdown without raw HTML, and links open in a new tab with `rel="noopener noreferrer"`.
- Server errors return a generic message. Details go to the server log.

## Project structure

```
prisma/
  schema.prisma       Data model (settings, conversations, messages, usage, tasks, projects, milestones, notes, folders)
  migrations/         SQL migrations
src/
  app/
    (app)/            Shell routes: dashboard, chat, tasks, notes, projects, settings, roadmap pages
    api/              Route handlers: settings, models, conversations, messages, usage, tasks, notes, projects, milestones, ai
  components/
    chat/             Chat workspace, transcript, composer, conversation list, model hook
    settings/         OpenRouter key, models, budget and usage cards
    tasks/            Tasks workspace, list, Kanban board, task dialog
    notes/            Notes workspace and Markdown editor with autosave
    projects/         Project list, dashboard, project and milestone dialogs
    ai/               Review dialog for AI proposals (confirm-before-apply)
    agents/           Agent workspace, builder dialog, live run view with approvals
    ui/               Buttons, inputs, dialog, tag input, empty and error states
    model-picker.tsx  Searchable model selector
  lib/
    chat/             Chat service (turns, persistence, history), SSE stream, types
    openrouter/       HTTP client, error mapping, model normalization, catalog cache
    crypto.ts         AES-256-GCM encryption for stored secrets
    settings.ts       Settings and key resolution
    usage.ts          Usage summaries and monthly spend
    tasks/            Task service, validation, board ordering
    notes/            Note and folder service, validation, Markdown helpers
    projects/         Project and milestone service, validation, progress logic
    ai/               Proposal prompts, JSON runner, sanitizers, and apply (all through OpenRouter)
    agents/           Run engine, tool registry, built-in agents, prompts, run history
    client/           Browser helpers: API client, autosave hook
e2e/                  Browser tests and the mock OpenRouter server
scripts/              Test runners and the test-data helper
```
