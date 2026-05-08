# Drivelytics — Car Rental Management

A full‑stack dashboard for managing car rentals. Built with Next.js 15
(App Router), TypeScript, Tailwind CSS, and Postgres (via Prisma).

> **Phase 1 ✓:** Postgres-backed CRUD with the same dashboard UX.
> **Phase 2 ✓:** AI agent with tool calling, in the dashboard chat panel.
> **Phase 3 ✓:** WhatsApp gateway (Baileys) wired to the agent + cron-driven
> proactive briefings.

## Features

- Beautiful, responsive dashboard (desktop table + mobile card layout).
- Live stats: total cars, active rentals, total revenue, outstanding balance.
- Add / Edit / Delete rentals (single or bulk multi‑select).
- Sortable columns, search across car / model / ID.
- All changes are persisted to **Postgres** instantly.
- **Import** any `.xlsx`, `.xls`, or `.csv` file with smart column mapping.
  Headers are matched fuzzily — `Vehicle / Car Name`, `From / Date Rented`,
  `Price / Rented Price`, etc. all map automatically.
- **Export** the current rentals as `cars.xlsx` with one click (generated
  on demand from the database).
- Validation, toasts, confirmation dialogs, keyboard shortcuts (Esc to close).
- Clean REST API: `GET / POST / PUT / DELETE /api/cars`,
  `POST /api/cars/import`, `GET /api/cars/export`.

## Prerequisites

- Node.js 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
  (used for the local Postgres container).

> The Postgres container binds to **host port 5433** (not 5432) so it can
> coexist with any other Postgres you already have running on 5432. If you
> want to change the port, edit `docker-compose.yml` and update
> `DATABASE_URL` in `.env` to match.

## First-time setup

```powershell
# 1. Install deps (also runs `prisma generate`)
npm install

# 2. Start Postgres in Docker
npm run db:up

# 3. Apply the initial migration (creates the `Car` table)
npm run db:migrate
#   → prompts for a name; "init" is fine.

# 4. (Optional) Seed from your existing data/cars.xlsx if you have one.
#    Safe to skip if starting fresh; safe to re-run (no-op if rows exist).
npm run db:seed

# 5. Run the app
npm run dev
```

Open <http://localhost:3000>.

## Daily dev flow

```powershell
npm run db:up       # start Postgres if it isn't running
npm run dev         # Next.js dev server
```

Stop everything:

```powershell
npm run db:down
```

## Useful scripts

| Script             | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `npm run db:up`    | Start the Postgres container (`docker compose up -d`).        |
| `npm run db:down`  | Stop the Postgres container.                                  |
| `npm run db:logs`  | Tail Postgres logs.                                           |
| `npm run db:migrate` | Create + apply a new migration (dev). Prompts for a name.   |
| `npm run db:reset` | Drop the DB and re-run all migrations (destructive).          |
| `npm run db:seed`  | Run `prisma/seed.ts` (imports legacy `data/cars.xlsx`).       |
| `npm run db:studio`| Open Prisma Studio (web UI to browse rows at :5555).          |
| `npm run db:generate` | Regenerate the Prisma client (rarely needed manually).     |

## Project structure

```
app/
  api/cars/route.ts          REST CRUD endpoints
  api/cars/import/route.ts   xlsx/csv upload
  api/cars/export/route.ts   xlsx download (generated from DB)
  layout.tsx                 Root layout (fonts, metadata)
  page.tsx                   Dashboard entry
components/
  Dashboard.tsx              Main page composition
  StatsCards.tsx             KPI cards
  CarTable.tsx               Sortable, selectable table + mobile cards
  CarFormModal.tsx           Add/Edit dialog
  ConfirmDialog.tsx          Reusable destructive confirm
  Toast.tsx                  Toast provider/hook
lib/
  prisma.ts                  Prisma client singleton (HMR-safe)
  cars.ts                    Postgres-backed data access (CRUD + bulk ops)
  xlsx-io.ts                 xlsx/csv parse + workbook serialization
  types.ts                   Shared types
prisma/
  schema.prisma              Postgres schema
  seed.ts                    One-shot import of legacy data/cars.xlsx
docker-compose.yml           Local Postgres (port 5432, named volume)
.env.example                 Copy to .env (already done in repo)
```

## Data schema

The `Car` table (Postgres):

| Column        | Type             | Notes                              |
| ------------- | ---------------- | ---------------------------------- |
| `id`          | text (PK)        | e.g. `c_lx9k2abcd` (legacy compat) |
| `carName`     | text             | Required                           |
| `model`       | text             | Required                           |
| `dateRented`  | date, nullable   | Sent/received as ISO `YYYY-MM-DD`  |
| `rentedTill`  | date, nullable   | Sent/received as ISO `YYYY-MM-DD`  |
| `rentedPrice` | double precision | ≥ 0                                |
| `advancePaid` | double precision | ≥ 0                                |
| `createdAt`   | timestamptz      | Auto                               |
| `updatedAt`   | timestamptz      | Auto                               |

Inspect rows via `npm run db:studio` — much nicer than opening Excel.

## API

| Method   | Endpoint             | Body                                   | Description                          |
| -------- | -------------------- | -------------------------------------- | ------------------------------------ |
| `GET`    | `/api/cars`          | —                                      | List all rentals                     |
| `POST`   | `/api/cars`          | `{ carName, model, ... }`              | Create a rental                      |
| `PUT`    | `/api/cars`          | `{ id, ...partial }`                   | Update a rental                      |
| `DELETE` | `/api/cars`          | `{ ids: string[] }`                    | Delete one or many rentals           |
| `POST`   | `/api/cars/import`   | `multipart/form-data` (`file`, `mode`) | Import .xlsx/.xls/.csv (replace/append) |
| `GET`    | `/api/cars/export`   | —                                      | Download `cars.xlsx`                 |

### Import column mapping

When importing, the first row is treated as a header row. Headers are
normalized (lowercased, non‑alphanumerics stripped) and matched against an
alias table. Recognized aliases per field:

| Field          | Accepted headers (case/spacing/punctuation insensitive)                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `id`           | id, rental id, record id                                                                              |
| `carName`      | car name, car, vehicle, vehicle name, name                                                            |
| `model`        | model, car model, variant, trim                                                                       |
| `dateRented`   | date rented, rented on, start date, from, date from, rent start, start, pickup date, pickup          |
| `rentedTill`   | rented till, end date, until, to, date to, rent end, end, return date, dropoff, dropoff date          |
| `rentedPrice`  | rented price, price, rent, amount, total price, total, rental price, rental, fee, cost                |
| `advancePaid`  | advance paid, advance, deposit, down payment, paid, advance amount, prepaid                           |

Rows missing a `Car Name` are skipped and reported in the response. Dates can
be Excel date cells, ISO strings, or any `Date.parse`‑compatible string —
they're normalized to `YYYY-MM-DD`. Numbers tolerate currency symbols and
thousand separators.

## Sample files

`scripts/make-samples.js` writes three example uploads to `scripts/samples/`
(one each for `.xlsx`, `.xls`, `.csv`) using deliberately mismatched header
names so you can confirm the smart mapping. Run it with:

```powershell
node scripts/make-samples.js
```

## AI assistant (Phase 2)

The dashboard ships with a "Ask AI" floating panel in the bottom-right
corner. The agent reads live data from Postgres and can mutate it through
a fixed set of tools:

| Tool             | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `listRentals`    | Filtered list (active / expiring / overdue / search)|
| `getRental`      | Look up by id or fuzzy phrase                       |
| `addRental`      | Create a rental                                     |
| `extendRental`   | Push out `rentedTill`                               |
| `markReturned`   | Set `rentedTill` to today                           |
| `recordPayment`  | Add to `advancePaid`                                |
| `deleteRental`   | Permanent delete (asks for confirmation)            |
| `getStats`       | Counts, revenue, outstanding, period summaries      |

The AI never touches the database directly — every read/write goes through
these tools, which call the same `lib/cars.ts` functions the REST API uses.
The agent itself is stateless; conversation history lives in the chat panel
and is sent up with each request.

### Configure a provider

The agent works against any OpenAI Chat Completions–compatible endpoint, plus
Anthropic Claude natively. Pick one block from `.env.example` and paste it
into `.env`, then restart `npm run dev`.

**Free options (recommended for testing):**

| Provider                                              | Setup           | Cost   | Notes                                            |
| ----------------------------------------------------- | --------------- | ------ | ------------------------------------------------ |
| [Groq](https://console.groq.com/keys)                 | Email signup    | Free   | Fast, generous quota, llama-3.3-70b tool calling |
| [Google Gemini](https://aistudio.google.com/apikey)   | Google account  | Free   | gemini-2.0-flash, free tier rate-limited         |
| [Ollama](https://ollama.com/)                         | Local install   | Free   | Fully offline; needs decent hardware             |

**Paid options:**

| Provider                                                            | Cost          | Notes                            |
| ------------------------------------------------------------------- | ------------- | -------------------------------- |
| [OpenAI](https://platform.openai.com/api-keys)                      | Pay-as-you-go | gpt-4o-mini is cheap and great   |
| [Anthropic Claude](https://platform.claude.com/settings/keys)       | Pay-as-you-go | claude-3-5-haiku is the budget pick |

The chat panel will surface a clear "AI not configured" hint if the key is
missing, so you can confirm the wiring without digging through logs. Expand
the **N actions** row in the chat to see which provider/model actually
served the request.

### Try these

- _"Which rentals are expiring this week?"_
- _"Show me the Civic — when does it come back?"_
- _"Ahmed paid 5000, please record it."_
- _"Extend the Corolla by 3 days."_
- _"Give me a summary for this month."_

The panel shows a collapsible **N actions** row so you can see which tools
the agent invoked and the raw JSON it received — handy for debugging.

After any mutation, the dashboard auto-refreshes via a custom event, so
table state stays in sync.

### Files

```
lib/ai/
  types.ts                 Provider-agnostic Message/ToolCall/ToolDef
  prompts.ts               System prompt (date-aware, tool-disciplined)
  agent.ts                 Orchestrator loop (max 6 steps per turn)
  tools.ts                 Tool catalog + dispatcher
  providers/
    openai.ts              OpenAI Chat Completions adapter
    anthropic.ts           Claude Messages API adapter
    index.ts               Env-driven factory + AIConfigError
app/api/ai/chat/route.ts   POST endpoint (stateless, validates input)
components/ChatPanel.tsx   Floating widget (history, tool call display)
```

## WhatsApp worker (Phase 3)

A separate Node process (`services/whatsapp/worker.ts`) opens a Baileys
WebSocket connection to WhatsApp Web, pipes incoming messages into the
**same agent** the dashboard uses, and sends replies back.

It also runs a `node-cron` job each morning that sends you a proactive
briefing if any rentals are expiring soon or overdue. Silence on quiet days.

> **Important:** Baileys is an unofficial reverse-engineered library. It's
> perfect for personal/internal use, but a sudden ban from WhatsApp would be
> costly if you ever expose this to customers. For customer-facing chat,
> migrate to the official WhatsApp Business Platform.

### Setup

1. **Configure env vars** in `.env`:

    ```dotenv
    # required: comma-separated allowlist (digits only, country code first)
    AI_ALLOWED_PHONES="923001234567"

    # optional: daily briefing
    AI_BRIEFING_PHONE="923001234567"
    AI_BRIEFING_CRON="0 9 * * *"
    AI_BRIEFING_TIMEZONE="Asia/Karachi"
    ```

    Anyone not on `AI_ALLOWED_PHONES` is silently ignored — the bot
    doesn't even reveal it exists.

2. **Run the worker** in a *second* terminal (keep `npm run dev` going in the
   first):

    ```powershell
    npm run whatsapp
    ```

3. **Pair your phone** — two ways:

    a) **From the dashboard (recommended).** Click the **WhatsApp** button
       in the dashboard header. The popup shows the QR as a crisp SVG and
       updates the connection status live every 1.5 seconds. Same modal
       lets you "Logout & re-pair" without touching the terminal.

    b) **From the terminal.** The worker also prints an ASCII QR. Scan it
       with WhatsApp → Settings → Linked Devices → Link a Device.

    Auth state is cached to `services/whatsapp/auth-state/` so subsequent
    launches reconnect silently. That folder is gitignored — never commit it.

    The dashboard button shows a colored dot at all times so you can spot
    state at a glance:
    🟢 connected · 🟡 needs scan · 🔵 connecting · 🔴 disconnected · ⚪ worker offline

### Talking to the bot

Send a message from any allowlisted number. Try:

- _"Which rentals are expiring this week?"_
- _"Find the Civic"_
- _"Ahmed paid 5000, record it."_
- _"Give me a summary for this month."_

Slash commands:

| Command   | Effect                                       |
| --------- | -------------------------------------------- |
| `/help`   | Show command list                            |
| `/clear`  | Wipe conversation memory for this chat       |
| `/status` | Show worker info (provider, model, uptime)   |

The worker keeps in-memory conversation history per phone for 30 minutes
of inactivity, capped at 40 messages. Restart the worker to wipe everything.

### Re-pairing / changing devices

Easiest: click the dashboard **WhatsApp** button → **Logout & re-pair**.

Or from a terminal:

```powershell
npm run whatsapp:logout    # deletes the cached auth state
npm run whatsapp           # boots fresh, prints a new QR
```

### Files

```
services/whatsapp/
  worker.ts                Entrypoint: wires Baileys -> agent -> reply
  baileys.ts               Connection, QR, send, auto-reconnect, triggerLogout
  state.ts                 In-memory connection-state singleton
  control-server.ts        HTTP control plane on 127.0.0.1:WA_CONTROL_PORT
  allowlist.ts             Phone/LID allowlist parsing & checks
  conversation-store.ts    Per-phone in-memory chat history with TTL
  briefing.ts              node-cron daily summary
  auth-state/              Persisted Baileys creds (gitignored)

app/api/whatsapp/
  status/route.ts          Proxy → worker /api/status (returns "worker_offline" when down)
  qr/route.ts              Proxy → worker /api/qr
  logout/route.ts          Proxy → worker /api/logout

components/
  WhatsAppButton.tsx       Header button + status dot
  WhatsAppModal.tsx        QR display + status + logout (uses qrcode pkg)
```

The worker imports `lib/ai/agent.ts` directly — no HTTP hop. The dashboard
chat panel and WhatsApp share the exact same agent, tools, and prompts.

The dashboard ↔ worker communication only carries connection-management
operations (status / QR / logout); message traffic stays inside the worker.

## Deploying online (Vercel + Neon + Koyeb)

Recommended free-tier setup:

```
Dashboard ──► Vercel    (free, native Next.js)
Database  ──► Neon      (free, serverless Postgres)
Worker    ──► Koyeb     (free Hobby tier, 512 MB)
```

The worker's WhatsApp auth state lives in Postgres (table `WhatsAppAuth`)
so it survives container restarts even on hosts without persistent disk.

### 0. Prerequisites

- A GitHub account
- The repo pushed to GitHub (see "Git setup" section)

### 1. Set up Postgres on Neon

1. Sign up at [neon.tech](https://neon.tech) (free tier, no credit card).
2. Create a project — pick a region close to you (e.g. **Frankfurt** for
   Pakistan/EU users; the free-tier endpoints are good).
3. Copy the **pooled connection string** (it'll look like
   `postgresql://user:pass@ep-xxx-pooler.neon.tech/dbname?sslmode=require`).
4. Apply migrations from your laptop:

    ```powershell
    # Temporarily point Prisma at Neon
    $env:DATABASE_URL = "<paste neon connection string>"
    npx prisma migrate deploy
    # (Optional) seed from your local xlsx
    npx prisma db seed
    ```

    `migrate deploy` (not `migrate dev`) is the right command for production
    — it applies pending migrations without prompting and never resets data.

### 2. Deploy the dashboard to Vercel

1. Sign up at [vercel.com](https://vercel.com), connect GitHub.
2. **Import project** → pick your repo.
3. Framework auto-detects as Next.js. Leave build command default.
4. Add environment variables — these are the **dashboard-only** ones:

    | Variable | Value |
    |---|---|
    | `DATABASE_URL` | your Neon pooled connection string |
    | `AI_PROVIDER` | `openai` |
    | `OPENAI_API_KEY` | your Groq key (or other compat key) |
    | `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` |
    | `OPENAI_MODEL` | `openai/gpt-oss-20b` |
    | `WA_CONTROL_BASE_URL` | (fill in **after** Koyeb deploy below) |
    | `WA_CONTROL_TOKEN` | a long random string (generate with `openssl rand -hex 32`) |

5. **Deploy.** Vercel runs `prisma generate && next build`, the dashboard
   goes live at `https://<your-project>.vercel.app`.

### 3. Deploy the worker to Koyeb

1. Sign up at [koyeb.com](https://koyeb.com) (free tier, GitHub auth).
2. **Create App** → from GitHub → pick your repo.
3. Service type: **Web Service** (yes, even though it's a worker — we
   expose the control plane HTTP endpoints).
4. Build settings:
    - Builder: **Buildpack** (auto-detects Node)
    - Build command: `npm install && npx prisma generate`
    - Run command: `npm run start:worker`
    - Port: `3001`
5. Region: pick whatever is closest to your phone for low WhatsApp
   latency.
6. Instance: **Free** (eco/512MB).
7. Environment variables:

    | Variable | Value |
    |---|---|
    | `DATABASE_URL` | same Neon connection string |
    | `AI_PROVIDER` | `openai` |
    | `OPENAI_API_KEY` | same Groq key |
    | `OPENAI_BASE_URL` | `https://api.groq.com/openai/v1` |
    | `OPENAI_MODEL` | `openai/gpt-oss-20b` |
    | `AI_ALLOWED_PHONES` | comma-separated list of allowed phone/LID identifiers |
    | `AI_BRIEFING_PHONE` | (optional) phone for daily briefing |
    | `AI_BRIEFING_TIMEZONE` | `Asia/Karachi` |
    | `WA_CONTROL_PORT` | `3001` |
    | `WA_CONTROL_HOST` | `0.0.0.0` |
    | `WA_CONTROL_TOKEN` | **same** random string as Vercel |

8. Health check path: `/api/health` (port 3001).
9. **Deploy.** Once it's live, copy the public URL (e.g.
   `https://drivelytics-worker-xxx.koyeb.app`) and:
    - Go back to Vercel → project settings → environment variables
    - Set `WA_CONTROL_BASE_URL` to that Koyeb URL
    - Redeploy the dashboard so the new env var takes effect

### 4. Pair the worker with WhatsApp

1. Open your Vercel dashboard URL.
2. Click the **WhatsApp** button — the modal shows a fresh QR.
3. Scan it from a phone whose number/LID is on `AI_ALLOWED_PHONES`.
4. Status flips to green. Auth is now persisted to Postgres — even if
   Koyeb restarts the container, the bot reconnects without a re-pair.

### 5. Confirm end-to-end

- Open the dashboard from your phone's browser → CRUD works.
- Send `/help` from an allowlisted WhatsApp → bot replies.
- Ask "which rentals expire this week?" → bot replies with live data
  from Neon.

### Cost summary

- **Neon free tier:** 0.5 GB storage, autoscaling-to-zero (no idle cost)
- **Vercel Hobby:** 100 GB bandwidth, unlimited deploys
- **Koyeb Free:** 1 web service, 512 MB RAM, ephemeral filesystem (we're
  fine — auth state is in Postgres)

For a single operator's bot this comfortably runs $0/month indefinitely.

### Watch out for

- **WhatsApp ban risk.** Baileys is unofficial. Don't put your primary
  number on a public bot. A cheap second SIM is the right move.
- **Cold-start latency.** Neon scales to zero after ~5 min idle and takes
  ~1 second to wake up. The first DB query after idle is slow; everything
  after is fine.
- **Koyeb sleep.** The free tier may sleep on inactivity. Set up a free
  uptime ping (e.g. [UptimeRobot](https://uptimerobot.com)) hitting
  `https://your-koyeb-url/api/health` every 5 min to keep it warm.

## Migrating from the xlsx-only version

If you previously ran the app pre-Postgres and have a populated
`data/cars.xlsx`, the seed script will pick it up:

```powershell
npm run db:seed
```

The xlsx file is left untouched on disk; the seed only reads from it. After
seeding, all reads/writes go to Postgres. You can keep using
**Import** / **Export** in the UI, but the canonical store is now the DB.
