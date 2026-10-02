import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Ship = {id:number; name:string};
type Booking = {id:number; shipId:number; pilotName:string; startTime:string; endTime:string};
type Slot = {startTime:string; endTime:string; available:boolean};
type Availability = {slots:Slot[]; unavailable:{startTime:string;endTime:string}[]};
const zone = 'America/Chicago';
const clock = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
const dayLabel = (value:string) => new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric'}).format(new Date(value));
const today = () => { const parts = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-'); };
async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const response = await fetch('/api'+path, init);
  if (!response.ok) {
    const body = await response.json().catch(()=>({detail:'Service unavailable. Please retry.'}));
    throw new Error(typeof body.detail==='string' ? body.detail : 'Please check the booking details and try again.');
  }
  return response.json();
}

export function App(){
  const [screen,setScreen] = useState<'charter'|'fleet'>('charter');
  const [ships,setShips] = useState<Ship[]>([]);
  const [ship,setShip] = useState(1);
  const [date,setDate] = useState(today);
  const [duration,setDuration] = useState(60);
  const [availability,setAvailability] = useState<Availability|null>(null);
  const [selected,setSelected] = useState<Slot|null>(null);
  const [pilot,setPilot] = useState('');
  const [bookings,setBookings] = useState<Booking[]>([]);
  const [allDates,setAllDates] = useState(true);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [revision,setRevision] = useState(0);
  useEffect(()=>{ let active=true; api<Ship[]>('/ships').then(data=>{if(active)setShips(data)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}; },[revision]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setSelected(null);setAvailability(null);setBookings([]);
    if(!date && (screen==='charter' || !allDates)){setLoading(false);return;}
    const path=screen==='charter' ? `/ships/${ship}/availability?date=${date}&durationMinutes=${duration}` : '/bookings'+(allDates?'':`?date=${date}`);
    api<Availability|Booking[]>(path,{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted)return;
      if(screen==='charter')setAvailability(data as Availability);else setBookings(data as Booking[]);
    }).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[screen,ship,date,duration,allDates,revision]);
  async function book(event:React.FormEvent){
    event.preventDefault(); if(!selected || saving)return;
    setSaving(true);setError('');setSuccess('');
    try {
      const booking=await api<Booking>('/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shipId:ship,pilotName:pilot,startTime:selected.startTime,endTime:selected.endTime})});
      setSuccess(`Charter #${booking.id} confirmed for ${pilot.trim()} · ${dayLabel(booking.startTime)}, ${clock(booking.startTime)}–${clock(booking.endTime)} CT.`);
      setPilot('');setRevision(v=>v+1);
    }catch(e){
      setError((e as Error).message);
      setSelected(null);
      // Refresh without clearing the conflict message; a stale slot must disappear.
      try {setAvailability(await api<Availability>(`/ships/${ship}/availability?date=${date}&durationMinutes=${duration}`));}catch{setAvailability(null)}
    }finally{setSaving(false)}
  }
  const activeShip=ships.find(s=>s.id===ship);
  return <div className="app">
    <aside><a className="brand" href="#" aria-label="Pacific Spaceport home"><span className="mark">✦</span><span>PACIFIC<br/><small>SPACEPORT</small></span></a><div className="nav-label">OPERATIONS</div><nav aria-label="Main navigation"><button className={screen==='charter'?'active':''} onClick={()=>{setScreen('charter');setSuccess('')}}><span>↗</span> Charter a ship</button><button className={screen==='fleet'?'active':''} onClick={()=>{setScreen('fleet');setSuccess('')}}><span>▦</span> Fleet manager</button></nav><div className="sidebar-bottom"><span className="status-dot"/> PORT OPERATIONS<br/><strong>06:00 — 22:00</strong><small>America/Chicago · Central Time</small></div></aside>
    <main><header><span>MISSION CONTROL <span className="slash">/</span> {screen==='charter'?'CHARTER OPERATIONS':'FLEET OVERVIEW'}</span><span className="live"><i/> SYSTEM ONLINE</span></header>
    <div className="page"><div className="title-row"><div><div className="eyebrow">PACIFIC SPACEPORT / DISPATCH</div><h1>{screen==='charter'?'Your next departure.':'The fleet, at a glance.'}</h1><p>{screen==='charter'?'Choose your vessel. Find a window. Make it official.':'Every charter, every pilot. One place to keep things moving.'}</p></div><span className="edition">PS—01<br/>CHARTER SYSTEM</span></div>
    {success&&<div className="notice success" role="status">✓ {success}</div>}
    {error&&<div className="notice error" role="alert">{error} <button onClick={()=>setRevision(v=>v+1)}>Retry</button></div>}
    {screen==='charter'?<>
      <section className="fleet-selector" aria-label="Select a ship">{ships.map((s,i)=><button key={s.id} disabled={saving} className={'ship-card '+(ship===s.id?'chosen':'')} onClick={()=>{setShip(s.id);setSuccess('')}}><span className="ship-top">VESSEL 0{s.id}<span>{ship===s.id?'●':'○'}</span></span><span className="ship-icon" aria-hidden="true">{['⟐','⋈','⟁','⟡','⌁'][i]}</span><strong>{s.name}</strong><small>Charter class / Pacific fleet</small></button>)}</section>
      <div className="booking-layout"><section className="panel"><div className="panel-heading"><span className="step">01</span><div><h2>Find your departure</h2><p>All times shown in Central Time.</p></div></div><div className="filters"><label>DEPARTURE DATE<input aria-label="Departure date" type="date" value={date} disabled={saving} onChange={e=>{setDate(e.target.value);setSuccess('')}}/></label><label>FLIGHT DURATION<select value={duration} disabled={saving} onChange={e=>setDuration(Number(e.target.value))}>{[30,60,90,120,180,240].map(n=><option key={n} value={n}>{n<60?'30 minutes':`${n/60} hours`}</option>)}</select></label></div>
      <div className="slots-heading"><h3>Departure windows</h3><span><i className="legend"/> Available <i className="legend blocked"/> Unavailable</span></div>
      {loading?<p role="status" className="empty">Checking the flight board…</p>:availability?<><div className="slots">{availability.slots.map(slot=><button key={slot.startTime} disabled={!slot.available||saving} aria-pressed={selected?.startTime===slot.startTime} className={selected?.startTime===slot.startTime?'selected':''} onClick={()=>setSelected(slot)}>{clock(slot.startTime)}</button>)}</div>{!availability.slots.some(s=>s.available)&&<p className="empty">No departures for this duration. Try another date or a shorter flight.</p>}<details><summary>Unavailable periods · includes refueling</summary>{availability.unavailable.length?availability.unavailable.map(i=><p key={i.startTime}>{clock(i.startTime)}–{clock(i.endTime)} CT</p>):<p>The full operating day is available.</p>}</details></>:<p className="empty">{date?'Availability could not be loaded.':'Choose a departure date.'}</p>}
      <div className="rule-note"><span>◷</span> Every charter includes a 30-minute refueling buffer between flights.</div></section>
      <section className="panel reservation"><div className="panel-heading"><span className="step">02</span><div><h2>Your charter</h2><p>Ready when you are.</p></div></div><div className="ticket"><span className="eyebrow">BOARDING DETAILS</span><h2>{activeShip?.name??'Select a ship'}</h2><dl><div><dt>Departure date</dt><dd>{date||'—'}</dd></div><div><dt>Flight time</dt><dd>{selected?`${clock(selected.startTime)}–${clock(selected.endTime)}`:'Choose a window'}</dd></div><div><dt>Duration</dt><dd>{duration} minutes</dd></div><div><dt>Time zone</dt><dd>Central Time</dd></div></dl></div><form onSubmit={book}><label>PILOT NAME<input required maxLength={100} value={pilot} disabled={saving} onChange={e=>setPilot(e.target.value)} placeholder="Enter the pilot’s full name"/></label><button className="primary" disabled={!selected||!pilot.trim()||saving||loading}>{saving?'Confirming…':'Confirm charter'} <span>↗</span></button><p className="fine-print">Your slot is reserved once the booking is confirmed.</p></form></section></div>
    </>:<><div className="dashboard-controls"><label className="toggle"><input type="checkbox" checked={allDates} onChange={e=>setAllDates(e.target.checked)}/> All dates, including history</label>{!allDates&&<label>OPERATING DATE<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>}<button className="refresh" onClick={()=>setRevision(v=>v+1)}>↻ Refresh</button><span>{loading?'Loading…':`${bookings.length.toLocaleString()} charters across ${ships.length} vessels`}</span></div>{loading?<p role="status" className="empty">Loading the fleet manifest…</p>:ships.map(s=>{const rows=bookings.filter(b=>b.shipId===s.id);return <section key={s.id} className="panel manifest"><div className="manifest-title"><h2><span className="vessel-number">0{s.id}</span>{s.name}</h2><span>{rows.length} charters</span></div>{rows.length?<div className="table-scroll"><table><thead><tr><th>CHARTER</th><th>PILOT</th><th>DATE (CT)</th><th>DEPARTURE (CT)</th><th>RETURN (CT)</th></tr></thead><tbody>{rows.map(b=><tr key={b.id}><td>#{String(b.id).padStart(4,'0')}</td><td>{b.pilotName}</td><td>{dayLabel(b.startTime)}</td><td>{clock(b.startTime)}</td><td>{clock(b.endTime)}</td></tr>)}</tbody></table></div>:<p className="empty">No charters scheduled{allDates?'':' for this date'}.</p>}</section>})}</>}
    <footer><span>PACIFIC SPACEPORT</span><span>Five ships. Endless possibilities.</span><span>ALL TIMES CENTRAL / CT</span></footer></div></main></div>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App/></StrictMode>);
