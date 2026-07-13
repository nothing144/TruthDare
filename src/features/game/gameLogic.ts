import { supabase } from '../../lib/supabase';
import type { Player, Room } from '../../types';
import { useGameStore } from '../../store/useGameStore';

export const startNextRound = async (roomArg: Room, players: Player[]) => {
  console.log('[DEBUG] startNextRound called');
  
  // Fetch latest room state to prevent double start race condition
  const { data: latestRoom, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomArg.id)
    .single();

  if (fetchError) {
    console.error('[DEBUG] fetchError', fetchError);
    return;
  }
  if (!latestRoom) {
    console.error('[DEBUG] no latestRoom');
    return;
  }
  
  if (latestRoom.status !== 'waiting' || latestRoom.current_phase !== 'waiting') {
    console.error('[DEBUG] Room is not waiting. Status:', latestRoom.status, 'Phase:', latestRoom.current_phase);
    return;
  }

  // Validate that the caller is the legitimate current spinner
  const activePlayers = players.filter(p => p.is_online !== false);
  const sortedPlayers = [...activePlayers].sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime());
  const currentSpinner = sortedPlayers.length > 0 ? sortedPlayers[(latestRoom.current_round || 0) % sortedPlayers.length] : null;

  const { currentPlayer } = useGameStore.getState();
  
  console.log('[DEBUG] Spinner validation:', {
    latestRoomCurrentRound: latestRoom.current_round,
    sortedPlayersCount: sortedPlayers.length,
    currentSpinnerId: currentSpinner?.id,
    currentPlayerId: currentPlayer?.id
  });

  if (currentSpinner?.id !== currentPlayer?.id) {
    console.error('Unauthorized: It is not your turn to spin.');
    return;
  }

  // 1. Pick a victim
  const availableVictims = players.filter(p => !p.has_been_victim);

  if (availableVictims.length === 0) {
    // Game over! Everyone has been a victim.
    await supabase.from('rooms').update({
      status: 'finished',
      current_phase: 'finished',
      state_master_id: null,
      phase_started_at: null,
      phase_duration_seconds: null,
      current_round_id: null
    }).eq('id', roomArg.id);
    return;
  }

  // Pick victim deterministically: next in line by join order
  const sortedVictims = [...availableVictims].sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime());
  const victim = sortedVictims[0];

  // 2. Pick a questioner
  const availableQuestioners = players.filter(p => p.id !== victim.id);
  const questioner = availableQuestioners[Math.floor(Math.random() * availableQuestioners.length)];

  // 3. Create round
  const { data: roundData, error: roundError } = await supabase.from('rounds').insert({
    room_id: roomArg.id,
    victim_id: victim.id,
    questioner_id: questioner.id,
    status: 'active'
  }).select().single();

  if (roundError) {
    console.error('Error creating round', roundError);
    throw roundError;
  }

  // 4. Update room to spinning
  // State master initial assignment is the questioner
  const { error: roomError } = await supabase.from('rooms').update({
    status: 'playing',
    current_round: latestRoom.current_round + 1,
    current_phase: 'spinning',
    state_master_id: questioner.id,
    phase_started_at: Date.now() - (useGameStore.getState().serverTimeOffset || 0),
    phase_duration_seconds: 5,
    current_round_id: roundData.id,
    last_activity: new Date().toISOString()
  }).eq('id', roomArg.id);

  if (roomError) {
    console.error('Error updating room', roomError);
    throw roomError;
  }

  return roundData;
};
