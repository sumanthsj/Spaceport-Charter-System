# Pacific Spaceport

A charter desk and fleet manager built with React + TypeScript, FastAPI, and SQLite.

## Run locally

Requirements: Python 3.11+ and Node.js 22.12+ (or Node 24). Run from the repository root.

```bash
python -m venv .venv
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python seed.py > seed.json
python -m backend.load_seed seed.json
cd frontend
npm ci
npm run build
cd ..
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open http://localhost:8000. API documentation: http://localhost:8000/docs.

The importer loads all 5 ships and 3,000 bookings from the supplied, unchanged `seed.py`. Import is atomic and safely skips an initialized database. Generated dates are relative to the seed run, and most records are historical: use **Fleet manager → All dates** to see them. Charter defaults to today in Central Time, which may have no seeded bookings. Data persists at `data/spaceport.db`; set `SPACEPORT_DB` to override it. Delete that file only to intentionally reset local data.

For development, run `uvicorn backend.main:app --reload` in one terminal and `cd frontend && npm run dev` in another; open http://localhost:5173. Vite proxies `/api` to Python. Build before starting the production Python server so it detects `frontend/dist`.

## Verify

```bash
python -m pytest -q
cd frontend
npm test
npm run build
```

25 tests cover overlaps, containment, both buffer directions, exact 30-minute gaps, independent ships, 06:00/22:00 boundaries, invalid/reversed/overnight ranges, required offsets, whitespace names, winter/summer and DST transition dates, merged unavailable intervals, duration-aware slots, manager filtering, atomic/idempotent import, and competing requests. Eight simultaneous attempts for one slot produce exactly one success and seven conflicts. Two React DOM tests exercise successful booking, manager display, API separation, and stale-slot conflict recovery. GitHub Actions runs both test suites and the frontend build.

Validation limitation: a real-browser smoke test was attempted, but Chromium downloads failed in the execution environment. Visual layout and real-browser behavior still need a manual check. API integration, production HTML serving, React DOM flows, and the TypeScript build were checked separately.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/ships` | Starting fleet |
| `GET /api/ships/{id}/availability?date=2026-10-01&durationMinutes=60` | Merged unavailable intervals including refueling, operating bounds, and server-evaluated slots |
| `POST /api/bookings` | Validate and atomically reserve a charter |
| `GET /api/bookings` | Full fleet history ordered by ship and start time |
| `GET /api/bookings?date=2026-10-01` | Manager bookings for one Central date |

Example request:

```json
{
  "shipId": 1,
  "pilotName": "Naomi Nagata",
  "startTime": "2026-10-01T09:00:00-05:00",
  "endTime": "2026-10-01T10:00:00-05:00"
}
```

Returns `201` with the booking and generated ID; `409` for booking/buffer conflicts; `422` for invalid input or hours; `404` for unknown ships; `503` with `Retry-After` if the writer stays busy for 10 seconds.

## Decisions to walk through

- **Small surface area:** two React views, one API module, one importer, one test module. No authentication, editing, cancellations, or unrelated infrastructure.
- **Time zones:** `America/Chicago` defines the operating day, including daylight saving. Inputs require offsets, persisted timestamps are UTC epochs, and browser labels explicitly format Central Time regardless of device zone. Backend-provided slot timestamps avoid converting local date inputs in the browser.
- **Half-open intervals:** conflict means `existing.start < new.end + 30m` and `existing.end > new.start - 30m`. Strict comparisons allow an exact 30-minute gap. Refueling may extend outside operating hours; the flight itself must fit entirely in 06:00–22:00.
- **Backend availability:** charter never fetches bookings. The endpoint expands each booking by 30 minutes on both sides, clips to hours, merges blocked intervals, and evaluates candidate slots. This prevents a flight ending too close before an existing departure as well as starting too soon after a return. Availability contains no pilot information.
- **Race prevention:** SQLite `BEGIN IMMEDIATE` reserves the writer before the conflict query. A competing request waits, sees the committed booking, and returns `409`. The importer uses the same validator inside one transaction. All supported writes use that helper; direct external SQL writes are outside this guarantee. WAL permits readers while a writer works. A ship/start index helps availability queries.
- **SQLite tradeoff:** no database service to provision, appropriate for a small fleet. Writes serialize across ships. At larger scale, migrate to PostgreSQL with an exclusion constraint on buffered timestamp ranges and introduce migrations.
- **UI scope:** departures every 30 minutes with common durations. Availability accepts multiples of 30 minutes up to 16 hours. Booking creation accepts arbitrary offset-aware times that satisfy business rules; the brief does not mandate increments or prohibit historical bookings.
- **Stale availability:** the server revalidates on submit. Conflicts display an error and refresh availability. The UI disables duplicate clicks while saving and cancels stale availability requests.
- **History:** all 3,000 seed bookings are available grouped by ship in scrollable tables. Add server pagination/date ranges as volume grows.

## Project map

```text
backend/main.py             API, database schema, booking rules, availability
backend/load_seed.py        Atomic seed import
backend/tests/test_api.py   Rule and concurrency coverage
frontend/src/main.tsx       Charter and fleet React views
frontend/src/style.css      Responsive layout and accessible focus states
seed.py                     Original supplied generator
ASSIGNMENT.md               Original brief
```

## Next steps

For production: migrations, pagination, browser tests in CI, request idempotency for ambiguous network failures, structured logging, and PostgreSQL if needed. Authentication is intentionally omitted per the brief. External Google Fonts are optional, with system font fallbacks.

## Publish to GitHub

After reviewing the project, use an authenticated GitHub CLI:

```bash
git init -b main
git add .
git commit -m "Build Spaceport Charter System"
gh repo create spaceport-charter --public --source=. --remote=origin --push
```

The `.gitignore` excludes data, generated seed JSON, virtual environments, builds, and dependencies. The project is not published until the command succeeds or GitHub publishing is connected.
