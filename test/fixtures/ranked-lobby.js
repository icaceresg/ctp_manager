export const lobbyId='20000000-0000-4000-8000-000000000001';
export function lobbyFixture(){
 return{schema_version:1,found:true,observed_at:'2026-10-23T12:00:00Z',
 lobby:{id:lobbyId,queue_id:'10000000-0000-4000-8000-000000000001',queue_title:'MW4 · Punto caliente',game_id:'g_mw4',mode:'Hardpoint',status:'ready',map_name:'Coal',created_at:'2026-10-23T11:00:00Z',closed_at:null,deadline_at:'2026-10-23T13:00:00Z'},
 players:Array.from({length:8},(_,i)=>({slot:i+1,username:'Player '+(i+1),side:i<4?'a':'b',is_captain:false,result_vote:i===0?'a':null})),
 result:{winner:null,resolution:null,resolution_truncated:false,votes_a:1,votes_b:0,confirmations_required:5,opens_at:'2026-10-23T11:10:00Z',decides_at:'2026-10-23T12:10:00Z',suspends_at:'2026-10-23T12:00:00Z'},
 chat:{messages:[{id:'9007199254740993',username:'Player 1',message:'<img src=x onerror=alert(1)>',is_system:false,created_at:'2026-10-23T11:30:00Z'}],has_more:false,next_before:null},map_draws:[{revision:1,map_name:'Coal',drawn_at:'2026-10-23T11:00:00Z',skipped_at:null}],open_disputes:0};
}
