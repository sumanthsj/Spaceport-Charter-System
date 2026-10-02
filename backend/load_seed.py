"""Import once into an empty database; reject invalid data atomically."""
import json
import sys
from .main import BookingInput, connect, init_db, insert_booking


def load_seed(path):
    with open(path) as source:
        data = json.load(source)
    init_db()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            if db.execute("SELECT 1 FROM ships LIMIT 1").fetchone():
                print("Database already initialized; seed import skipped.")
                db.rollback()
                return
            db.executemany("INSERT INTO ships(id,name) VALUES(:id,:name)", data["ships"])
            for raw in data["bookings"]:
                insert_booking(db, BookingInput(**raw))
            db.commit()
        except Exception:
            db.rollback()
            raise
    print(f"Imported {len(data['ships'])} ships and {len(data['bookings'])} bookings.")


if __name__ == "__main__":
    load_seed(sys.argv[1])
