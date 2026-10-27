export const PLAYER_PAGE_SIZE=20;
export const playerOffset=value=>/^\d{1,6}$/.test(value||'')&&Number(value)<=999999?Number(value):0;
export const playerTab=value=>['summary','results','tickets','sanctions'].includes(value)?value:'summary';
export const participationLabel=state=>({idle:'Sin cola ni partida',queued:'En cola',presence_expired:'Presencia de cola caducada',in_lobby:'En partida'})[state]||'Sin lectura';
export function playerWaitSeconds(participation,observedAt){
 if(participation?.state!=='queued'||!participation.joined_at)return null;
 const seconds=(Date.parse(observedAt)-Date.parse(participation.joined_at))/1000;
 return Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):null;
}
export function playerResult(row){
 if(row.status==='cancelled')return 'Cancelada';
 if(!row.winner||!row.my_side)return 'Sin resultado asignado';
 return row.winner===row.my_side?'Victoria':'Derrota';
}
