export type RoomStatus = 'waiting' | 'playing' | 'finished';

export type GamePhase = 
  | 'waiting' 
  | 'spinning' 
  | 'choosing_truth_dare' 
  | 'discussion' 
  | 'question_submission' 
  | 'answering' 
  | 'answer_review'
  | 'live_stream' 
  | 'voting' 
  | 'finished';

export interface Room {
  id: string;
  room_code: string;
  status: RoomStatus;
  current_round: number;
  current_phase: GamePhase;
  state_master_id: string | null;
  phase_started_at: number | null;
  phase_duration_seconds: number | null;
  current_round_id: string | null;
  created_at: string;
  last_activity: string;
}

export interface Player {
  id: string;
  room_id: string;
  name: string;
  score: number;
  rank: number;
  is_online: boolean;
  has_been_victim: boolean;
  joined_at: string;
}

export interface Round {
  id: string;
  room_id: string;
  victim_id: string | null;
  questioner_id: string | null;
  type: 'truth' | 'dare' | null;
  status: string;
  created_at: string;
  ended_at: string | null;
}
