// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, test, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from './main';

afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const slot={startTime:'2026-10-01T11:00:00+00:00',endTime:'2026-10-01T12:00:00+00:00',available:true};
function server(conflict=false){
 let booked=false;
 const booking={id:1,shipId:1,pilotName:'Test Pilot',...slot};
 const fetch=vi.fn(async(path:string,options?:RequestInit)=>{
   if(path==='/api/ships')return {ok:true,json:async()=>[{id:1,name:'Serenity'}]};
   if(path.includes('/availability'))return {ok:true,json:async()=>({slots:[{...slot,available:!booked}],unavailable:[]})};
   if(options?.method==='POST'){
     booked=true;
     return {ok:!conflict,json:async()=>conflict?{detail:'Slot already booked'}:booking};
   }
   return {ok:true,json:async()=>booked?[booking]:[]};
 });
 vi.stubGlobal('fetch',fetch);
 return fetch;
}

test('charter uses availability, submits, disables booked slot, and manager shows pilot',async()=>{
 const fetch=server(); const user=userEvent.setup();render(<App/>);
 await user.click(await screen.findByRole('button',{name:'6:00 AM'}));
 expect(fetch.mock.calls.some(([url])=>url==='/api/bookings')).toBe(false);
 await user.type(screen.getByPlaceholderText('Enter the pilot’s full name'),'Test Pilot');
 await user.click(screen.getByRole('button',{name:/Confirm charter/}));
 await screen.findByText(/Charter #1 confirmed/);
 await waitFor(()=>expect((screen.getByRole('button',{name:'6:00 AM'}) as HTMLButtonElement).disabled).toBe(true));
 const post=fetch.mock.calls.find(([,options])=>options?.method==='POST');
 expect(JSON.parse(post![1]!.body as string)).toEqual({shipId:1,pilotName:'Test Pilot',startTime:slot.startTime,endTime:slot.endTime});
 await user.click(screen.getByRole('button',{name:/Fleet manager/}));
 await screen.findByRole('cell',{name:'Test Pilot'});
});

test('stale slot conflict is explained and refreshed',async()=>{
 server(true); const user=userEvent.setup();render(<App/>);
 await user.click(await screen.findByRole('button',{name:'6:00 AM'}));
 await user.type(screen.getByPlaceholderText('Enter the pilot’s full name'),'Test Pilot');
 await user.click(screen.getByRole('button',{name:/Confirm charter/}));
 await screen.findByRole('alert');
 expect(screen.getByRole('alert').textContent).toContain('Slot already booked');
 await waitFor(()=>expect((screen.getByRole('button',{name:'6:00 AM'}) as HTMLButtonElement).disabled).toBe(true));
});
