export function monitorFixture() {
  const queueId = '10000000-0000-4000-8000-000000000001';
  return {schema_version:1, observed_at:'2026-10-23T12:00:00Z', window_started_at:'2026-10-22T12:00:00Z',
    summary:{waiting_players:6,waiting_parties:2,solo_players:2,active_lobbies:1,players_in_lobbies:8,active_queues:1,open_queues:1},
    queues:[{id:queueId,title:'MW4 · Punto caliente',game_id:'g_mw4',mode:'Hardpoint',is_open:true,waiting_players:6,waiting_parties:2,solo_players:2,wait_avg_seconds:30.5,wait_max_seconds:70,active_lobbies:1,map_count:7,presence_expired_players:1}],
    lobby_statuses:[{status:'ready',count:1}],
    active_lobbies:[{id:'20000000-0000-4000-8000-000000000001',queue_id:queueId,queue_title:'MW4 · Punto caliente',status:'ready',mode:'Search & Destroy',mode_pending:false,map_name:'Coal',created_at:'2026-10-23T11:55:00Z',deadline_at:null,age_seconds:300,players:8,side_a:4,side_b:4,result_votes:0,open_disputes:0}],
    activity_24h:{created_matches:3,completed_matches:1,cancelled_matches:1,disputes_opened:1,map_draws:4,map_skips:1,duration_avg_seconds:1020},
    map_activity:[{game_id:'g_mw4',mode:'Hardpoint',map_name:'Coal',draws_24h:2,skips_24h:1,active_in_pool:true}],
    map_plays:null,map_plays_window:null,map_plays_criterion:null,queue_players:null,
    truncated:{queues:false,active_lobbies:false,map_activity:false,map_plays:null,queue_players:null}};
}

export function monitorPeopleAndMapsFixture() {
  const data = monitorFixture(), queue = data.queues[0];
  data.map_plays_window='all_time'; data.map_plays_criterion='confirmed_results';
  data.map_plays=[
    {game_id:'g_mw4',mode:'Hardpoint',map_name:'Coal',played_matches:10,played_matches_24h:1,last_played_at:'2026-10-23T11:58:00Z',active_in_pool:true},
    {game_id:'g_mw4',mode:'Search & Destroy',map_name:'Cachette',played_matches:3,played_matches_24h:0,last_played_at:'2026-10-20T11:58:00Z',active_in_pool:false},
    {game_id:'g_mw4',mode:'Hardpoint',map_name:'Rooftops',played_matches:0,played_matches_24h:0,last_played_at:null,active_in_pool:true},
  ];
  data.queue_players=Array.from({length:3},(_,index)=>({user_id:`30000000-0000-4000-8000-00000000000${index+1}`,username:`Jugador ${index+1}`,gamertag:`Gamer ${index+1}`,activision_id:index===0?'SinNumeros':`Jugador#${index+1}`,queue_id:queue.id,queue_title:queue.title,
    party_id:index===0?null:'40000000-0000-4000-8000-000000000001',party_size:index===0?1:2,joined_at:'2026-10-23T11:59:10Z',presence_expires_at:'2026-10-23T12:01:00Z',wait_seconds:50}));
  data.truncated.map_plays=false; data.truncated.queue_players=false;
  return data;
}
