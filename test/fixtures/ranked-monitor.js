export function monitorFixture() {
  const queueId = '10000000-0000-4000-8000-000000000001';
  return {schema_version:1, observed_at:'2026-10-23T12:00:00Z', window_started_at:'2026-10-22T12:00:00Z',
    summary:{waiting_players:6,waiting_parties:2,solo_players:2,active_lobbies:1,players_in_lobbies:8,active_queues:1,open_queues:1},
    queues:[{id:queueId,title:'MW4 · Punto caliente',game_id:'g_mw4',mode:'Hardpoint',is_open:true,waiting_players:6,waiting_parties:2,solo_players:2,wait_avg_seconds:30.5,wait_max_seconds:70,active_lobbies:1,map_count:7,presence_expired_players:1}],
    lobby_statuses:[{status:'ready',count:1}],
    active_lobbies:[{id:'20000000-0000-4000-8000-000000000001',queue_id:queueId,queue_title:'MW4 · Punto caliente',status:'ready',mode:'Search & Destroy',mode_pending:false,map_name:'Coal',created_at:'2026-10-23T11:55:00Z',deadline_at:null,age_seconds:300,players:8,side_a:4,side_b:4,result_votes:0,open_disputes:0}],
    activity_24h:{created_matches:3,completed_matches:1,cancelled_matches:1,disputes_opened:1,map_draws:4,map_skips:1,duration_avg_seconds:1020},
    map_activity:[{game_id:'g_mw4',mode:'Hardpoint',map_name:'Coal',draws_24h:2,skips_24h:1,active_in_pool:true}],
    truncated:{queues:false,active_lobbies:false,map_activity:false}};
}
