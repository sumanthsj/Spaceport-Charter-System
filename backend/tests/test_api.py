from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app, connect
from backend.load_seed import load_seed


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('SPACEPORT_DB', str(tmp_path / 'test.db'))
    with TestClient(app) as client:
        with connect() as db:
            db.executemany('INSERT INTO ships VALUES(?,?)', [(1,'Serenity'),(2,'Rocinante')])
        yield client


def payload(start='2026-01-15T10:00:00-06:00', end='2026-01-15T11:00:00-06:00', ship=1):
    return dict(shipId=ship, pilotName='  Test Pilot  ', startTime=start, endTime=end)


def test_create_and_persist(client):
    response = client.post('/api/bookings', json=payload())
    assert response.status_code == 201
    assert response.json()['pilotName'] == 'Test Pilot'
    assert response.json()['startTime'] == '2026-01-15T16:00:00+00:00'
    assert client.get('/api/bookings').json() == [response.json()]


@pytest.mark.parametrize('start,end', [
    ('10:00','11:00'),('10:30','11:30'),('09:00','12:00'),('10:15','10:45'),
    ('09:00','10:00'),('11:00','12:00'),('09:00','09:31'),('11:29','12:00')])
def test_conflicts_and_refuel(client,start,end):
    client.post('/api/bookings', json=payload())
    assert client.post('/api/bookings',json=payload(f'2026-01-15T{start}:00-06:00',f'2026-01-15T{end}:00-06:00')).status_code == 409


@pytest.mark.parametrize('start,end', [('09:00','09:30'),('11:30','12:00')])
def test_exact_buffer_allowed(client,start,end):
    client.post('/api/bookings',json=payload())
    assert client.post('/api/bookings',json=payload(f'2026-01-15T{start}:00-06:00',f'2026-01-15T{end}:00-06:00')).status_code == 201


def test_ship_isolation(client):
    client.post('/api/bookings',json=payload())
    assert client.post('/api/bookings',json=payload(ship=2)).status_code == 201
    assert client.post('/api/bookings',json=payload(ship=99)).status_code == 404


@pytest.mark.parametrize('start,end', [('05:59','07:00'),('21:00','22:01'),('10:00','10:00'),('11:00','10:00')])
def test_invalid_hours(client,start,end):
    assert client.post('/api/bookings',json=payload(f'2026-01-15T{start}:00-06:00',f'2026-01-15T{end}:00-06:00')).status_code == 422


@pytest.mark.parametrize('day,offset', [('2026-01-15','-06:00'),('2026-07-15','-05:00'),('2026-03-08','-05:00'),('2026-11-01','-06:00')])
def test_operating_boundaries_and_dst(client,day,offset):
    assert client.post('/api/bookings',json=payload(day+'T06:00:00'+offset,day+'T22:00:00'+offset)).status_code == 201
    board=client.get(f'/api/ships/1/availability?date={day}').json()
    assert not any(s['available'] for s in board['slots'])


def test_cross_day_naive_and_blank_rejected(client):
    assert client.post('/api/bookings',json=payload(end='2026-01-16T07:00:00-06:00')).status_code == 422
    assert client.post('/api/bookings',json=payload(start='2026-01-15T10:00:00')).status_code == 422
    assert client.post('/api/bookings',json={**payload(),'pilotName':'  '}).status_code == 422


def test_availability_merges_buffers_and_has_no_pilot_data(client):
    client.post('/api/bookings',json=payload())
    client.post('/api/bookings',json=payload('2026-01-15T11:30:00-06:00','2026-01-15T12:30:00-06:00'))
    data=client.get('/api/ships/1/availability?date=2026-01-15&durationMinutes=60').json()
    assert data['unavailable'] == [{'startTime':'2026-01-15T15:30:00+00:00','endTime':'2026-01-15T19:00:00+00:00'}]
    assert 'pilotName' not in json.dumps(data)
    slots={s['startTime']:s['available'] for s in data['slots']}
    assert slots['2026-01-15T14:30:00+00:00'] is True  # ends exactly at blocked start
    assert slots['2026-01-15T15:00:00+00:00'] is False
    assert slots['2026-01-15T19:00:00+00:00'] is True
    assert client.get('/api/ships/99/availability?date=2026-01-15').status_code == 404
    assert client.get('/api/ships/1/availability?date=bad').status_code == 422
    assert client.get('/api/ships/1/availability?date=2026-01-15&durationMinutes=31').status_code == 422


def test_concurrent_requests_only_one_wins(client):
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes=list(pool.map(lambda _:client.post('/api/bookings',json=payload()).status_code, range(8)))
    assert codes.count(201) == 1
    assert codes.count(409) == 7
    assert len(client.get('/api/bookings').json()) == 1


def test_manager_filter(client):
    client.post('/api/bookings',json=payload())
    assert len(client.get('/api/bookings?date=2026-01-15').json()) == 1
    assert client.get('/api/bookings?date=2026-01-16').json() == []


def test_seed_atomic_and_idempotent(tmp_path,monkeypatch):
    monkeypatch.setenv('SPACEPORT_DB',str(tmp_path/'seed.db'))
    file=tmp_path/'seed.json'
    data={'ships':[{'id':1,'name':'Serenity'}],'bookings':[payload(),payload()]}
    file.write_text(json.dumps(data))
    with pytest.raises(Exception): load_seed(file)
    with connect() as db: assert db.execute('SELECT count(*) FROM ships').fetchone()[0] == 0
    data['bookings'].pop()
    file.write_text(json.dumps(data))
    load_seed(file)
    load_seed(file)
    with connect() as db: assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 1
