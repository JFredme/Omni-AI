# OMNI AI: project progress

Branch: `part-3-tasks-notes-projects` (not pushed). Last updated after the agent framework.
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

## Not built yet (in roadmap order)
- **Chat extras:** message editing, branching, file/image attachments, code highlighting, export, comparison, summarization, tool calling in chat, capability detection per model.
- **Tasks/notes extras:** recurring tasks, dependencies, backlinks, rich-text editor, activity history, AI note rewriting, smart scheduling.
- **Memory** (semantic search, edit/delete/export, privacy controls). Needs embeddings; decide on provider (OpenRouter embeddings endpoint vs. pgvector).
- **Knowledge base** (uploads, parsing, chunking, embeddings, vector search, RAG with citations). New dependencies needed for PDF/DOCX/XLSX parsing.
- **Research** (needs a configurable web search provider and its API key).
- **Calendar** and scheduling (Google Calendar needs OAuth credentials).
- **Automations** (workflow builder and background execution; reuse the agent run engine's resumable-loop approach).
- **Coding workspace** (Monaco, sandboxed execution: must not run AI commands on the host without isolation and approval).
- **Document generation** (PDF/DOCX/PPTX/XLSX libraries), **integrations** (OAuth for Gmail, Calendar, Drive, GitHub, Notion, Todoist, Discord, Slack).
- **Universal AI command bar**, **analytics dashboard**, **real home dashboard data** (done: home is now real data from `/api/dashboard`).
- **Security still open:** secure uploads (arrives with attachments/knowledge base). Auth, protected routes, CSRF origin check, rate limits and the audit log are done (`src/proxy.ts`, `src/lib/auth/*`).
- **Docker** configuration; **.env.example** exists but should be reviewed when new variables appear.
- Built-in agents still missing (they need tools that don't exist yet): Research, Coding, Email, Calendar, Document Analyst, Data Analyst, Automation.

## Design notes worth knowing
- `src/lib/ai/run.ts` `runAiJson` is the single non-streaming AI entry point (JSON in, validated JSON out, usage recorded, `onUsage` callback). Agents and AI proposals both use it.
- Agent run cost: `AgentRun.costUsd` of a parent includes its delegated children's cost. For analytics, sum `UsageRecord` (one per model call) instead of summing runs, or only top-level runs, to avoid double counting.
- Agent tools live in `src/lib/agents/tools.ts` and load services lazily so unit tests need no database. Any browser code must import agent constants from `src/lib/agents/types.ts`, never from `schemas.ts` or `tools.ts`.
- zod 4: `.partial()` keeps `.default()` values. Update schemas must be built from fields without defaults (this caused a real bug, covered by a regression test).
- Prisma `contains` does not escape `%`/`_`; use `escapeLike` from `src/lib/search.ts`.
- Test databases: `omni_ai_test` (integration) and `omni_ai_e2e` (browser). `scripts/clear-test-data.mjs` truncates a fixed table list; add new tables there.

## Known limitations
- Agent budgets rely on OpenRouter-reported or catalog-estimated cost; a model with no known price counts as unknown cost, so only step and time limits bound it.
- Delegated agents cannot use tools that need approval.
- AI JSON replies were verified against a mock OpenRouter server, not against live models.
- `npm audit` reports 9 high-severity advisories in the dependency tree (not addressed).

## Test results (last full run)
- typecheck, lint: pass.
- Unit: 188 passed (31 files). Integration: 77 passed (6 files, real Postgres, mocked OpenRouter). E2E on a production build: smoke 9, chat 10, productivity 25, agents 14, all passed.
