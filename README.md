# OMNI AI

A single workspace for AI chat, agents, productivity, research, knowledge, code, and automation.
Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Prisma, and PostgreSQL.

## Status

This repository is at **Part 4 (in progress): the agent framework is done; memory, knowledge, research, calendar, automation, coding, documents, and integrations are not**. See `PROJECT_PROGRESS.md` for the full list.

| Area | Status |
| --- | --- |
| App shell, routing for all 13 sections, themes, command palette, shortcuts | Done (Part 1) |
| OpenRouter API key settings (encrypted at rest, environment fallback, connection test) | Done |
| Model catalog (live from OpenRouter, cached, search, free/paid and capability filters, favorites, default model) | Done |
| Streaming chat (stop, regenerate, retry, model switching, system instructions, rename, delete) | Done |
| Persistent conversations and messages (PostgreSQL via Prisma) | Done |
| Usage tracking (tokens, cost, 30-day breakdown), monthly spending limit | Done |
| Password sign-in, protected pages and API, rate limiting, audit log | Done (see Security) |
| Chat attachments, tool calling, JSON mode, branching | Not started |
| Knowledge base (PDF, Word, Excel, CSV, Markdown, text, code, images; hybrid search; citations in chat) and memory | Done |
| Tasks (priorities, due dates, subtasks, tags, search, filters, sorting, Kanban board) | Done (Part 3) |
| Notes (Markdown, autosave, folders, tags, search, pinning) | Done (Part 3) |
| Projects (status, milestones, progress dashboards, linked tasks) | Done (Part 3) |
| AI integration (break a project into tasks, project plans, note summaries, task priorities, organize tasks and notes), always confirm-before-apply | Done (Part 3) |
| Agents (builder, run engine, tool registry, approvals, limits, cancellation, bounded delegation, run history) | Done (Part 4, first phase) |
| Calendar, research, code, automations, analytics | Not started (routes show a "Not built yet" page) |

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

## Knowledge base and memory

**Knowledge** (`/knowledge`) turns your files into something chat and agents can search, and shows where every answer came from.

- **Adding things.** Upload PDF, Word (`.docx`), Excel (`.xlsx`), CSV, Markdown, text, source code, or images (PNG, JPEG, WebP, GIF), paste text, or index your notes. Files up to 15 MB. Only the extracted text is kept; the original file is not stored. Scanned PDFs have no text to extract, so upload their pages as images instead. Image text comes from a model reading the picture, so it can contain mistakes, and the document says so.
- **How search works.** Text is split into pieces of about 1,000 characters, each remembering its page (PDF) or heading (Markdown). Each piece is turned into a vector with an OpenRouter embedding model (default `openai/text-embedding-3-small`, changeable through `PATCH /api/knowledge/settings`) and stored in PostgreSQL. A question is embedded the same way and compared by cosine similarity, with a small bonus for exact word matches. Anything below a relevance floor is dropped rather than shown as a weak match.
- **When embeddings aren't available** (no key, a failing model, a spent budget), documents are still saved and found by keyword, and the page tells you why meaning-based search is off. **Re-index** retries.
- **Scale.** Vectors live in ordinary columns and are compared in the server's memory, which is fine for personal use (tens of thousands of pieces). It is not pgvector; very large libraries would want that.
- **Citations in chat.** With the **Knowledge** toggle on, each message searches your documents, and the model is given the top passages as numbered sources and told to cite them as `[1]`. The sources are saved with the reply. Sources the reply cites are highlighted; the others are shown as retrieved but not cited. Text inside your documents is passed as data, not instructions, and tags in it are neutralized so it can't close the block it sits in.
- **Memory** is a list of facts you choose to keep ("I prefer metric units"). Relevant ones are sent along with your message while **Use memories in chat** is on; turn it off and none leave your database. Add them on the Memory tab, or choose **Remember this** under any message you sent. You can edit, search, export as JSON, or delete them all (a confirmation is required).
- **Agents.** `search_knowledge` and `search_memory` are read tools available to every agent; `remember` writes, so it asks for approval by default. The built-in **Document Analyst** answers from your documents and names the source.

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

- **Sign-in.** The first time you open the app it asks you to set a password. After that every page and every API route requires a session (a 30-day, HTTP-only cookie). Only a hash of the cookie token is stored in the database, and passwords are hashed with scrypt. Anyone who can reach the server before you set the password can claim it, so set it right away and don't expose a fresh install to a network.
- **Forgot the password?** There's no email reset. Run `TRUNCATE "AuthConfig", "AuthSession";` in your database, then open the app and set a new one.
- **Protection against forged requests.** Writes from another site are refused (the `Origin` header must match the host), and the cookie is `SameSite=Lax`.
- **Rate limits.** 8 wrong passwords per 15 minutes, 600 writes per minute, and 40 model-spending requests per minute. They live in memory, so they reset when the server restarts. Behind a reverse proxy, set `TRUST_PROXY=1` so limits use the real client address from `X-Forwarded-For`.
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
