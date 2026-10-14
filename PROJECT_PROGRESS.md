# OMNI AI: project progress

Branch: `part-3-tasks-notes-projects` (not pushed). Last updated after automations.
Stack: Next.js 16.4 (App Router, `cacheComponents`), React 19, TypeScript, Tailwind v4, Prisma 7, PostgreSQL. AI only through OpenRouter.

## How to resume
1. `npm ci`, make sure Postgres is up and `.env` has `DATABASE_URL` and `ENCRYPTION_KEY` (never print or commit it), `npm run db:migrate`.
2. Gates: `npm run typecheck && npm run lint && npx vitest run && npm run test:integration && npm run test:e2e`.
3. Read `AGENTS.md` first. Next 16 differs from older versions: read `node_modules/next/dist/docs/` before writing routes or pages. Dynamic routes must read `params` inside `<Suspense>` (see `src/app/(app)/projects/[id]/page.tsx`). After a client navigation the previous page stays mounted but hidden, so e2e selectors need `:visible`.

## Done and verified
| Area | Status |
| --- | --- |
| Shell, themes, ⌘K palette (Part 1) | done |
| OpenRouter key, model catalog, streaming chat, conversations, usage, budget (Part 2) | done |
| Tasks: priorities, due dates, subtasks, tags, filters, sort, search, Kanban | done |
| Notes: Markdown, autosave, folders, tags, search, pinning | done |
| Projects: status, milestones, progress dashboards, linked tasks | done |
| AI proposals: project plan/tasks, note summary, priorities, organize; confirm-before-apply | done |
| Agents: builder, engine, tools, approvals, limits, cancel, delegation, history, crash recovery | done |
| UI redesign (paper-and-ink palette, serif headings, flat layout) and a home dashboard driven by real data (`/api/dashboard`) | done |
| Security: password sign-in (scrypt), DB sessions, `src/proxy.ts` gate for every page and API route, CSRF origin check, rate limits, audit log, security settings card | done |
| Knowledge base: PDF/DOCX/XLSX/CSV/MD/TXT/code/image ingestion, chunking with page/heading, OpenRouter embeddings, hybrid semantic+keyword search, document viewer, notes indexing | done |
| Chat extras: message tree (edit + regenerate branches, sibling switcher), image/document attachments with capability check, code highlighting, export (md/txt/json), summarize (with save-as-note / add-as-tasks), model comparison page | done |
| Calendar: events with time-zone-correct repeats, month/week/agenda UI, task/milestone overlay, .ics import/export, AI time blocking (propose/apply), home schedule, `list_events`/`create_event` tools, Calendar Assistant agent | done |
| Automations: workflow model, engine (sequential steps, run history, recovery), scheduler via `src/instrumentation.ts`, event triggers (`emitAppEvent`), webhooks (`/api/hooks/[token]`), SSRF-guarded HTTP step, visual flow editor, templates | done |
| Memory: add/edit/search/export/delete, global on/off, "Remember this" in chat; RAG in chat with saved, numbered citations; agent tools `search_knowledge`, `search_memory`, `remember`; Document Analyst agent | done |

## Not built yet (in roadmap order)
- **Chat still missing:** tool calling inside a chat (agents cover tools).
- **Tasks/notes extras:** recurring tasks, dependencies, backlinks, rich-text editor, activity history, AI note rewriting, smart scheduling.
- **Research** (needs a configurable web search provider and its API key).
- **Google Calendar sync** (needs a Google OAuth client; calendar itself and .ics import/export are done).
- **Coding workspace** (Monaco, sandboxed execution: must not run AI commands on the host without isolation and approval).
- **Document generation** (PDF/DOCX/PPTX/XLSX libraries), **integrations** (OAuth for Gmail, Calendar, Drive, GitHub, Notion, Todoist, Discord, Slack).
- **Universal AI command bar**, **analytics dashboard**, **real home dashboard data** (done: home is now real data from `/api/dashboard`).
- **Security still open:** none of the listed items; uploads are validated (extension, magic bytes, size, text-only decoding) and never stored or served. Re-audit when attachments and integrations land.
- **Docker** configuration; **.env.example** exists but should be reviewed when new variables appear.
- Built-in agents still missing (they need tools that don't exist yet): Research, Coding, Email, Data Analyst, Automation.

## Design notes worth knowing
- `src/lib/ai/run.ts` `runAiJson` is the single non-streaming AI entry point (JSON in, validated JSON out, usage recorded, `onUsage` callback). Agents and AI proposals both use it.
- Agent run cost: `AgentRun.costUsd` of a parent includes its delegated children's cost. For analytics, sum `UsageRecord` (one per model call) instead of summing runs, or only top-level runs, to avoid double counting.
- Agent tools live in `src/lib/agents/tools.ts` and load services lazily so unit tests need no database. Any browser code must import agent constants from `src/lib/agents/types.ts`, never from `schemas.ts` or `tools.ts`.
- zod 4: `.partial()` keeps `.default()` values. Update schemas must be built from fields without defaults (this caused a real bug, covered by a regression test).
- Prisma `contains` does not escape `%`/`_`; use `escapeLike` from `src/lib/search.ts`.
- Auth: `src/proxy.ts` (Node runtime) validates the `omni_session` cookie against `AuthSession` on every request except `/login` and `/api/auth/{status,login,setup}`. New API routes are protected automatically; do not add public routes without adding them to `PUBLIC_PATHS` in `src/lib/auth/guard.ts` and a test. Uploads pass through the proxy, so `experimental.proxyClientMaxBodySize` is raised to 20 MB in `next.config.ts` (otherwise bodies are silently truncated at 10 MB).
- Knowledge: vectors are unit-length float32 `Bytes` compared in memory (`src/lib/knowledge/service.ts` index cache, invalidated on every write). Embedding runs in the background (`embedDocument`, tracked in `globalThis.__omniKnowledge`, resumed by `recoverIngests`). Retrieved text is fenced and tag-neutralized before it reaches a prompt (`context.ts`).
- Node fetch reuses idle sockets that Next closes after ~5 s; e2e helpers use `retryingFetch` (`e2e/session.mjs`).
- Test databases: `omni_ai_test` (integration) and `omni_ai_e2e` (browser). `scripts/clear-test-data.mjs` truncates a fixed table list; add new tables there.

## Known limitations
- Embeddings, image reading and all AI features were verified against a mock OpenRouter server, not live models; the default embedding model id (`openai/text-embedding-3-small`) is OpenRouter's, check it is available to your key.
- Search compares vectors in server memory; thousands of documents are fine, a very large library would need pgvector.
- Rate limits and failed-login counters are in memory and reset on restart. The first visitor to a fresh install sets the password.
- Agent budgets rely on OpenRouter-reported or catalog-estimated cost; a model with no known price counts as unknown cost, so only step and time limits bound it.
- Delegated agents cannot use tools that need approval.
- AI JSON replies were verified against a mock OpenRouter server, not against live models.
- `npm audit` reports 9 high-severity advisories in the dependency tree (not addressed).

## Test results (last full run)
- typecheck, lint: pass.
- Unit: 296 passed (46 files). Integration: 163 passed (11 files, real Postgres, mocked OpenRouter). E2E on a production build: auth 9, smoke 9, chat 10, productivity 25, agents 14, knowledge 17, chat-extras 14, calendar 14, automations 13, all passed.
