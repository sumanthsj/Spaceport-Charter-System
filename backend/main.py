"""Small, single-process-friendly charter API. All persisted timestamps are UTC epochs."""
import os
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import AwareDatetime, BaseModel, Field, field_validator

CENTRAL = ZoneInfo("America/Chicago")
BUFFER = 30 * 60
DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "spaceport.db"


@contextmanager
def connect():
    path = Path(os.environ.get("SPACEPORT_DB", DEFAULT_DB))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript('''
            CREATE TABLE IF NOT EXISTS ships (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY, ship_id INTEGER NOT NULL REFERENCES ships(id),
                pilot_name TEXT NOT NULL CHECK(length(trim(pilot_name)) BETWEEN 1 AND 100),
                start_time REAL NOT NULL, end_time REAL NOT NULL,
                CHECK(end_time > start_time));
            CREATE INDEX IF NOT EXISTS bookings_ship_start ON bookings(ship_id, start_time);
        ''')


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title="Pacific Spaceport", lifespan=lifespan)


class BookingInput(BaseModel):
    shipId: int = Field(gt=0)
    pilotName: str = Field(min_length=1, max_length=100)
    startTime: AwareDatetime
    endTime: AwareDatetime

    @field_validator("pilotName")
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError("Pilot name cannot be blank")
        return value.strip()


def bounds(day):
    return (datetime.combine(day, time(6), CENTRAL),
            datetime.combine(day, time(22), CENTRAL))


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def booking_json(row):
    return {"id": row["id"], "shipId": row["ship_id"], "pilotName": row["pilot_name"],
            "startTime": iso(row["start_time"]), "endTime": iso(row["end_time"])}


def require_ship(db, ship_id):
    if not db.execute("SELECT 1 FROM ships WHERE id=?", (ship_id,)).fetchone():
        raise HTTPException(404, "Ship not found")


def insert_booking(db, booking):
    """Caller must hold a write transaction (BEGIN IMMEDIATE) before checking."""
    require_ship(db, booking.shipId)
    start, end = booking.startTime.timestamp(), booking.endTime.timestamp()
    day = booking.startTime.astimezone(CENTRAL).date()
    opening, closing = (d.timestamp() for d in bounds(day))
    if not opening <= start < end <= closing:
        raise HTTPException(422, "Booking must start before it ends, within 6 AM–10 PM Central on one day")
    conflict = db.execute(
        "SELECT 1 FROM bookings WHERE ship_id=? AND start_time < ? AND end_time > ? LIMIT 1",
        (booking.shipId, end + BUFFER, start - BUFFER),
    ).fetchone()
    if conflict:
        raise HTTPException(409, "This time conflicts with a booking or its 30-minute refueling buffer")
    cursor = db.execute(
        "INSERT INTO bookings(ship_id,pilot_name,start_time,end_time) VALUES(?,?,?,?)",
        (booking.shipId, booking.pilotName, start, end),
    )
    return booking_json(db.execute("SELECT * FROM bookings WHERE id=?", (cursor.lastrowid,)).fetchone())


@app.get("/api/ships")
def ships():
    with connect() as db:
        return [dict(r) for r in db.execute("SELECT * FROM ships ORDER BY id")]


@app.get("/api/ships/{ship_id}/availability")
def availability(ship_id: int, date: date, durationMinutes: int = Query(60, ge=30, le=960, multiple_of=30)):
    """Return merged blocked intervals and server-evaluated candidate slots, no pilot data."""
    opening, closing = bounds(date)
    lo, hi = opening.timestamp(), closing.timestamp()
    with connect() as db:
        require_ship(db, ship_id)
        rows = db.execute(
            "SELECT start_time,end_time FROM bookings WHERE ship_id=? AND start_time < ? AND end_time > ? ORDER BY start_time",
            (ship_id, hi + BUFFER, lo - BUFFER),
        ).fetchall()
    intervals = []
    for row in rows:
        start, end = max(lo, row["start_time"] - BUFFER), min(hi, row["end_time"] + BUFFER)
        if intervals and start <= intervals[-1][1]:
            intervals[-1][1] = max(intervals[-1][1], end)
        else:
            intervals.append([start, end])
    slots = []
    start = lo
    duration = durationMinutes * 60
    while start + duration <= hi:
        end = start + duration
        slots.append({"startTime": iso(start), "endTime": iso(end),
                      "available": not any(start < b and end > a for a, b in intervals)})
        start += 1800
    return {"date": date.isoformat(), "timezone": "America/Chicago", "refuelMinutes": 30,
            "opensAt": iso(lo), "closesAt": iso(hi),
            "unavailable": [{"startTime": iso(a), "endTime": iso(b)} for a, b in intervals],
            "slots": slots}


@app.post("/api/bookings", status_code=201)
def create_booking(booking: BookingInput):
    with connect() as db:
        try:
            # Reserve the SQLite writer BEFORE reading: concurrent requests cannot both pass.
            db.execute("BEGIN IMMEDIATE")
            result = insert_booking(db, booking)
            db.commit()
            return result
        except sqlite3.OperationalError as exc:
            db.rollback()
            if "locked" in str(exc).lower():
                raise HTTPException(503, "Spaceport is busy; please retry", headers={"Retry-After": "1"}) from exc
            raise
        except Exception:
            db.rollback()
            raise


@app.get("/api/bookings")
def bookings(date: date | None = None):
    # Full history is explicitly available to the fleet manager. Charter uses availability only.
    with connect() as db:
        sql, params = "SELECT * FROM bookings", ()
        if date:
            lo, hi = bounds(date)
            sql += " WHERE start_time >= ? AND start_time < ?"
            params = (lo.timestamp(), hi.timestamp())
        return [booking_json(r) for r in db.execute(sql + " ORDER BY ship_id,start_time,id", params)]


# A production frontend build is served by the same Python server, after API routes.
frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if frontend.is_dir():
    app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
