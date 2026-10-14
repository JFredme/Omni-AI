# OMNI AI

A single workspace for AI chat, agents, productivity, research, knowledge, code, and automation.
Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Prisma, and PostgreSQL.

## Status

This repository is at **Part 2: OpenRouter AI chat**.

| Area | Status |
| --- | --- |
| App shell, routing for all 13 sections, themes, command palette, shortcuts | Done (Part 1) |
| OpenRouter API key settings (encrypted at rest, environment fallback, connection test) | Done |
| Model catalog (live from OpenRouter, cached, search, free/paid and capability filters, favorites, default model) | Done |
| Streaming chat (stop, regenerate, retry, model switching, system instructions, rename, delete) | Done |
| Persistent conversations and messages (PostgreSQL via Prisma) | Done |
| Usage tracking (tokens, cost, 30-day breakdown), monthly spending limit | Done |
| Accounts and sign-in | Not started (see Security) |
| File attachments, image input, tool calling, JSON mode, branching, memory | Not started |
| Tasks, notes, calendar, projects, agents, knowledge, research, code, automations, analytics | Not started (routes show a "Not built yet" page) |

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
| `npm run test:integration` | Chat service tests against a real Postgres database (see below) |
| `npm run test:e2e` | Full browser suite: builds the app, starts a mock OpenRouter server, runs the smoke and chat tests |

### Integration tests

`npm run test:integration` runs the chat service against a real database, with only the OpenRouter HTTP calls mocked. Create a test database first:

```bash
createdb omni_ai_test
```

The script applies migrations to `TEST_DATABASE_URL` (default `postgresql://USER@localhost:5432/omni_ai_test`) and then runs the tests. Both the tests and the data-clearing helper refuse to run against a database whose name doesn't end in `_test` or `_e2e`.

### End-to-end tests

`npm run test:e2e` needs Google Chrome installed. It uses `E2E_DATABASE_URL` (default `.../omni_ai_e2e`), clears that database's tables, builds the app, and runs:

- `e2e/smoke.mjs`: shell, routing, themes, responsive layout, and the 404 page.
- `e2e/chat.mjs`: saving and testing a key (valid and invalid), the model picker, streaming, stop, mid-stream errors, persistence across reloads, renaming, the spending limit, usage totals, and deletion.

The mock OpenRouter server in `e2e/mock-openrouter.mjs` follows the documented request and response formats. It is not the live OpenRouter service. To check against the live API, run the app with a real key and try a message.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Open or close the command palette |
| `⌘B` / `Ctrl+B` | Collapse or expand the sidebar |
| `⌘,` / `Ctrl+,` | Open settings |
| `↑` / `↓`, `Enter`, `Esc` | Navigate, run, or close within the palette |
| `Enter` / `Shift+Enter` (chat) | Send / new line |

## Data and privacy

- **Stored in PostgreSQL:** settings (including the encrypted OpenRouter key, default model, favorites, and monthly limit), conversations, messages, and one usage record per reply attempt.
- **Stored in the browser:** the theme and sidebar state, in `localStorage`.
- **Sent to OpenRouter:** the conversation history for each request, plus any system instructions you set for that conversation.
- **Never returned to the browser:** the OpenRouter key. The Settings page shows only its last four characters.
- Deleting a conversation removes its messages. Its usage records are kept so totals stay accurate.

## Security

- **There is no sign-in yet.** Every API route is unauthenticated, so anyone who can reach the server can read your conversations and spend against your saved key. The dev and start scripts bind to `127.0.0.1` for this reason. Don't expose the server to a network until accounts are added.
- Model output is rendered as Markdown without raw HTML, and links open in a new tab with `rel="noopener noreferrer"`.
- Server errors return a generic message. Details go to the server log.

## Project structure

```
prisma/
  schema.prisma       Data model (settings, conversations, messages, usage)
  migrations/         SQL migrations
src/
  app/
    (app)/            Shell routes: dashboard, chat, settings, roadmap pages
    api/              Route handlers: settings, models, conversations, messages, usage
  components/
    chat/             Chat workspace, transcript, composer, conversation list, model hook
    settings/         OpenRouter key, models, budget and usage cards
    model-picker.tsx  Searchable model selector
  lib/
    chat/             Chat service (turns, persistence, history), SSE stream, types
    openrouter/       HTTP client, error mapping, model normalization, catalog cache
    crypto.ts         AES-256-GCM encryption for stored secrets
    settings.ts       Settings and key resolution
    usage.ts          Usage summaries and monthly spend
e2e/                  Browser tests and the mock OpenRouter server
scripts/              Test runners and the test-data helper
```
