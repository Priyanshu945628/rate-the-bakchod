# Rate the Bakchod

A feed where you post evidence — an image, a video, a voice note, a screenshotted
tweet — and everyone rates how big a bakchod the subject is, 1 to 10. The
consistently worst offenders rise to the leaderboard. A house AI posts and roasts
alongside everyone else but is never scored and never ranked.

Media is not kept in an ordinary blob store. The backend encrypts every upload,
pushes the ciphertext to the Internet Archive, and keeps a decrypted derivative in
a local disk cache so the feed loads fast.

## Setup

Requires Node 24+, plus `ffmpeg` and `ffprobe` on `PATH` (the upload pipeline
shells out to them for transcoding, poster frames and duration checks).

```bash
npm install
cp .env.example .env.local     # then fill it in — see the comments in that file
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

That last command prints a `MEDIA_MASTER_KEY`. **Back it up.** It wraps every
per-file data key; without it every archived file is permanently unreadable.

Check your work before starting anything:

```bash
npm run check-env
```

That reports which variables are missing, still holding `.env.example`
placeholders, or structurally wrong — a master key that isn't 32 bytes, a
connection string whose password needs percent-encoding, a service-role key
pasted where the publishable key belongs. It never prints a value, so its output
is safe to share.

Then create the schema and start:

```bash
npx prisma migrate deploy    # or `migrate dev` while iterating on the schema
npx prisma generate
npm run dev
```

In Supabase, enable the Google provider under Authentication → Providers, and set
Site URL and the redirect allow-list to match `NEXT_PUBLIC_SITE_URL` with
`/auth/callback` appended.

To make yourself an admin, flip the flag on your row after your first sign-in:

```sql
UPDATE "User" SET "isAdmin" = true WHERE "handle" = 'your-handle';
```

### Running without Internet Archive keys

Set `STORAGE_DRIVER=disk`. Ciphertext goes to `.storage/` instead, and everything
else — encryption, key wrapping, the cache, crypto-shredding — behaves identically.
Useful offline and for tests.

## Commands

| Command | What it does |
|---|---|
| `npm run check-env` | Preflight on `.env.local` / `.env`. Prints no values. |
| `npm run dev` | Dev server. Also starts an in-process tick that drives the AI bakchod every few minutes so you can watch it work. |
| `npm run build` / `npm start` | Production build and serve. `build` generates the Prisma client first. |
| `npm test` | Vitest: crypto round-trips and shredding, the weighted score, rate-limit windows. |
| `npm run lint` | ESLint, including the React Compiler rules Next 16 ships. |

## Deploying

**One service, not two.** There is no separate backend to deploy. Next serves the
UI and everything under `app/api/`, and the archive uploader runs inside that same
process — `instrumentation.ts` boots it at startup and the request path hands it
work through a spool on local disk, not over a network. The only other moving part
is Postgres, which Supabase already hosts. So this is a single service pointed at
the repo, with the standard pair of commands; `next start` honours whatever `PORT`
the platform injects.

```bash
npm run build
npm start
```

`build` runs `prisma generate` before `next build`. The generated client lives in
`node_modules`, which is not committed, and `@prisma/client` v7 no longer generates
it from an install hook — so on a fresh checkout a bare `next build` fails on a
client that was never generated. It sits in the build script rather than in
`postinstall` because some builders copy only `package.json` into the install
layer, where `prisma/schema.prisma` does not exist yet.

**`ffmpeg` and `ffprobe` must be in the image.** The upload pipeline shells out to
them for transcoding, poster frames and duration probing. Without them, video and
audio uploads fail at the door while images keep working — a confusing way to find
out. `nixpacks.toml` in the repo root is there for exactly this, and `.nvmrc` pins
the Node major alongside it:

```toml
[phases.setup]
nixPkgs = ["...", "ffmpeg"]
```

`"..."` is literal there, not a placeholder: it means *keep the packages Nixpacks
already picked*. That file is only read when the builder actually is Nixpacks —
Railway chooses one per service under **Settings → Build** and the default moves
over time, so if a video upload fails in production, run `ffmpeg -version` in a
deploy shell before suspecting the pipeline. On a builder that resolves package
sets differently — Docker, Heroku buildpacks — install the two binaries however
that image does it; nothing in the app cares where they came from, only that they
answer on `PATH`.

**Mount a volume and point `DATA_DIR` at it.** Three directories are written at
runtime: `.cache/media` (plaintext derivatives), `.spool` (ciphertext waiting for
the archive) and `.storage` (only under `STORAGE_DRIVER=disk`). A container
filesystem is wiped on every deploy and two of those cannot survive that — the
spool is the only copy of ciphertext the archive has not accepted yet, and the
cache is the only servable copy of media until it has. Deploy without a volume and
a post made shortly before it goes `FAILED` with *"Spooled ciphertext is missing"*
while its media 404s. One variable rather than three because a host gives you one
volume per service. Mount it outside the app directory — `/data` is the
conventional choice, and `/app` would shadow the code — then set `DATA_DIR` to that
path. Keep the service at a single replica for as long as the cache and spool are
local disk: a second replica gets its own empty volume and serves 404s for media
the first one is holding.

**Environment.** Everything in `.env.example`, set as service variables rather than
an uploaded file:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Transaction pooler, 6543, with `?pgbouncer=true&connection_limit=1`. |
| `DIRECT_URL` | Session pooler, 5432. Migrations only. |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key. The service-role key is never needed and must never be set. |
| `NEXT_PUBLIC_SITE_URL` | The deployed origin. Read in exactly one place — the welcome splash's CSP — so a wrong value blocks that iframe; it has no effect on sign-in. |
| `MEDIA_MASTER_KEY` | The **same** 32 bytes as before. A fresh one leaves every existing file unreadable. |
| `CRON_SECRET` | Authenticates the tick route below. |
| `STORAGE_DRIVER` · `IA_ACCESS_KEY` · `IA_SECRET_KEY` · `IA_ITEM_PREFIX` | Archive credentials. |
| `DATA_DIR` | The volume's mount path. |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_BASE_URL` · `BAKCHOD_MODEL` | Optional. Without a key the bot posts from the scripted pool. The base URL points the SDK at a proxy — origin only, no `/v1`. |
| `TURN_URL` · `TURN_USERNAME` · `TURN_CREDENTIAL` | Optional relay. Without it, calls between two awkward networks fail to connect. |

The four `NEXT_PUBLIC_` values are inlined into the client bundle at build time, so
they must be present for the build and a change to one needs a redeploy, not a
restart. `npm run check-env` works the same way on the server as it does locally
and still prints no values.

**Auth.** Supabase → Authentication → URL Configuration wants the deployed origin as
its Site URL, and `<origin>/auth/callback` in the redirect allow-list. That list is
the part sign-in actually depends on: `startGoogleSignIn` builds the redirect from
`window.location.origin`, so an origin the list has not been told about comes back
as a sign-in button that goes nowhere. Keep the `http://localhost:3000/auth/callback`
entry alongside it, or dev sign-in stops working. Nothing changes in the Google
console — Supabase is the broker there, and Google only ever sees
`…supabase.co/auth/v1/callback`.

**Schema.** Once per database: `npx prisma migrate deploy` against `DIRECT_URL`, or
paste `prisma/migrations/*/migration.sql` into the Supabase SQL editor — the same
statements either way.

**The tick.** `instrumentation.ts` starts the in-process AI timer only outside
production, deliberately: a timer inside a process the platform restarts and scales
is not a scheduler. In production point a cron at `POST /api/cron/bakchod` every
few minutes with `Authorization: Bearer $CRON_SECRET`. That route also recovers
stuck uploads, drains the archive queue and prunes expired rate-limit rows, so it
earns its schedule even with no Anthropic key at all.

Any scheduler that can set a header works — a Railway cron service in the same
project whose start command curls the URL, or something external. Missing a tick is
not data loss: a new upload kicks the archive drain in-process. What the schedule
buys is the bot posting on its own, and a retry for an upload that failed while the
process was down.

## How it fits together

```
POST /api/posts ──▶ media pipeline ──▶ .cache/media (plaintext derivative)
                         │                    │
                         │                    └──▶ post is live immediately
                         └──▶ AES-256-GCM ──▶ queue ──▶ Internet Archive
```

**Upload.** `lib/media/pipeline.ts` sniffs the real MIME type from magic bytes
rather than trusting the browser, caps size and duration, then normalises: video
to H.264/AAC MP4 with `+faststart` and a poster frame, images re-encoded through
sharp. That re-encode is what strips EXIF, GPS included. It hashes the result for
duplicate detection, encrypts it under a fresh random data key, wraps that key
with `MEDIA_MASTER_KEY`, writes the plaintext derivative to the disk cache, and
inserts the post as `PENDING` — returning before the archive upload happens.

**Archive.** `worker/archive-uploader.ts` drains the queue to IAS3, checking
`?check_limit=1` for backpressure first and backing off on `503 SlowDown`.
`PENDING → UPLOADING → UPLOADED → VERIFIED`, the last once a HEAD on the download
URL succeeds. Ingestion there is asynchronous and can take minutes, which is why
the disk cache is load-bearing for correctness and not just for speed.

**Serving.** `GET /api/media/[key]` streams from the cache; on a miss it fetches
the ciphertext back from archive.org, unwraps the key, decrypts, repopulates the
cache and streams. Range requests are supported so video seeking works.

**Deleting.** The Internet Archive has no delete. So a delete here destroys the
wrapped data key in Postgres instead — crypto-shredding. The ciphertext stays
where it is and becomes permanently undecryptable. `test/crypto.test.ts` walks
that scenario end to end.

## Scoring

```
R = the person's mean rating       v = ratings their posts have received
m = 10 (smoothing)                C = global mean across all non-AI ratings

bakchodScore = (v / (v + m)) * R + (m / (v + m)) * C
```

The smoothing is the point: it takes sustained agreement to rank, so one friend
handing out a single 10 does almost nothing. With `C = 5.5`, a lone 10 scores
**5.91**; fifty ratings averaging 8.0 score **7.58**; five hundred averaging 8.0
score **7.95**. Trending uses a separate `hotScore` that decays with age:
`ratings24h / (hours + 2) ^ 1.5`.

**The AI is never scored.** `User.isAI` means no rating control is rendered, the
rate endpoint rejects the post, and every leaderboard and stats query filters the
bot out — so it cannot even move the global mean. It plays; it does not compete.

## Guard rails

Ratings are unique per `(post, rater)` at the database level, self-rating is
rejected, and the 1..10 range is a `CHECK` constraint, not just API validation.
Rate limits live in Postgres rather than memory so a restart does not reset them:
5 uploads/hr, 60 ratings/hr, 20 comments/hr, 10 reports/day, all in
`lib/config.ts`.

Moderation is post-hoc and transparent, Reddit-style: nothing screens uploads on
the way in. Anyone can report; `/admin` lists open reports and can hide, shred, or
dismiss. Deny-all RLS is enabled on every table as defence in depth — all real
access is server-side through Prisma as the table owner, so this only means a
leaked publishable key reads nothing.

## The AI bakchod

`lib/ai/bakchod.ts` runs on Claude (`claude-opus-5` by default; set
`BAKCHOD_MODEL=claude-haiku-4-5` for the cheap tier). It sees the cached
derivative, so it reacts to what is actually in the picture. Its persona prompt
is cached and its tone rails are explicit: playful Hinglish teasing about the
*content* of a post, never slurs, body-shaming, or anything keyed to caste,
religion, gender or appearance. Refusals, rate limits and API errors all fall
through to a scripted Hinglish pool, so the bot never just goes quiet.

`POST /api/cron/bakchod` drives it, authenticated with `CRON_SECRET` — point a
scheduler at it every few minutes in production. The same route also recovers
stuck uploads, drains the archive queue and prunes expired rate-limit rows.
Locally, `instrumentation.ts` runs the tick in-process instead.

## Notes on the stack

Next.js 16 renamed middleware to **Proxy** — the root file is `proxy.ts`, and it
exists to refresh Supabase auth cookies on navigation. Route protection uses
`getClaims()`, not `getSession()`. Prisma 7 moved the datasource URL out of
`schema.prisma` into `prisma.config.ts`, and this app talks to Postgres through
the `@prisma/adapter-pg` driver adapter. There are no CSS gradients anywhere in
the theme, by design.
