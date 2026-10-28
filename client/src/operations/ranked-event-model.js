export const EVENT_READ_INTERVAL_MS=30000;
export const EVENT_STALE_MS=75000;

/** No slot exists before the first read, while OFF, or for a legacy response. */
export function rankedEventBoundaryAttempt(snapshot,lastBoundary){
 const window=snapshot?.map_rotation?.next_rotation_at;
 return window&&lastBoundary?.window===window?lastBoundary.at:null;
}

/** Keep a successful but cached status read from extending an expired slot. */
export function eventObservationReceivedAt(previous,receivedAt,next,now){
 if(!Number.isFinite(now))return 0;
 if(!previous||!Number.isFinite(receivedAt)||now<receivedAt)return now;
 const prior=Date.parse(previous.server_time),observed=Date.parse(next.server_time);
 if(!Number.isFinite(prior)||!Number.isFinite(observed)||observed<prior)throw new Error('La hora del evento ha retrocedido. Actualiza para comprobar el estado.');
 return now-Math.max(0,prior+now-receivedAt-observed);
}

/** Server time plus elapsed local time controls only display, never map selection. */
export function rankedEventReading(snapshot,receivedAt,now,stale=false){
 const elapsed=now-receivedAt,server=Date.parse(snapshot?.server_time);
 if(!snapshot)return{status:'unavailable',serverNow:null,seconds:null,rotation:null};
 if(stale||!Number.isFinite(elapsed)||elapsed<0||elapsed>=EVENT_STALE_MS||!Number.isFinite(server))return{status:'stale',serverNow:null,seconds:null,rotation:null};
 const rotation=snapshot.map_rotation,serverNow=server+elapsed;
 if(!rotation)return{status:'unavailable',serverNow,seconds:null,rotation:null};
 if(!snapshot.enabled||!rotation.enabled)return{status:'off',serverNow,seconds:null,rotation};
 const end=Date.parse(rotation.next_rotation_at);
 if(!Number.isFinite(end)||serverNow>=end)return{status:'boundary',serverNow,seconds:0,rotation:null};
 return{status:'active',serverNow,seconds:Math.max(0,Math.ceil((end-serverNow)/1000)),rotation};
}

/** Read-only refresh policy: visible only, bounded retries, and a slot-boundary refresh. */
export function rankedEventReadDue({snapshot,receivedAt,lastAttemptAt,lastBoundaryAttemptAt=null,now,visible,stale=false}){
 if(!visible||!Number.isFinite(now))return false;
 const sinceAttempt=lastAttemptAt===null?Infinity:now-lastAttemptAt;
 const reading=rankedEventReading(snapshot,receivedAt,now,stale);
 if(reading.status==='boundary')return lastBoundaryAttemptAt===null||now<lastBoundaryAttemptAt||now-lastBoundaryAttemptAt>=5000;
 if(sinceAttempt>=0&&sinceAttempt<EVENT_READ_INTERVAL_MS)return false;
 return !snapshot||stale||now<receivedAt||now-receivedAt>=EVENT_READ_INTERVAL_MS;
}

export function rotationCountdown(seconds){
 if(!Number.isSafeInteger(seconds)||seconds<0)return '—';
 return`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
