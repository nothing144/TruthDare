import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { supabase } from '../../lib/supabase';
import type { Round } from '../../types';
import SpinnerPhase from './SpinnerPhase';
import ChoosingPhase from './ChoosingPhase';
import DiscussionPhase from './DiscussionPhase';
import QuestionPhase from './QuestionPhase';
import AnswerPhase from './AnswerPhase';
import AnswerReviewPhase from './AnswerReviewPhase';
import VotingPhase from './VotingPhase';
import LiveStreamPhase from './LiveStreamPhase';

export default function GameManager() {
  const { room, currentPlayer, players } = useGameStore();
  const [currentRound, setCurrentRound] = useState<Round | null>(null);

  useEffect(() => {
    if (!room) return;

    // Fetch the active round safely tied to the room's current state
    const fetchRound = async () => {
      if (!room.current_round_id) {
        setCurrentRound(null);
        return;
      }

      const { data } = await supabase
        .from('rounds')
        .select('*')
        .eq('id', room.current_round_id)
        .single();

      if (data) setCurrentRound(data);
    };

    fetchRound();

    // Subscribe to rounds table
    const channel = supabase
      .channel(`rounds:${room.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${room.id}` },
        (_payload) => {
          fetchRound();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, room?.current_round]);

  // Player drop guard
  useEffect(() => {
    if (!room || !currentPlayer || room.status !== 'playing') return;
    
    // If active players drop below 3, abort the game
    const activePlayers = players.filter(p => p.is_online !== false); // fallback to true if undefined
    if (activePlayers.length < 3) {
      const abortGame = async () => {
        await supabase.from('rooms').update({ 
          status: 'finished', 
          current_phase: 'finished' 
        }).eq('id', room.id);
      };
      abortGame();
    }
  }, [players, room?.status, room?.id, currentPlayer]);

  // Deterministic State Master Assignment
  useEffect(() => {
    if (!room || !currentRound || !currentPlayer || room.status !== 'playing') return;

    const activePlayers = players.filter(p => p.is_online !== false);
    const questionerOnline = activePlayers.some(p => p.id === currentRound.questioner_id);
    const victimOnline = activePlayers.some(p => p.id === currentRound.victim_id);

    let nextMasterId: string | null = null;
    if (questionerOnline) {
      nextMasterId = currentRound.questioner_id;
    } else if (victimOnline) {
      nextMasterId = currentRound.victim_id;
    } else if (activePlayers.length > 0) {
      const oldestPlayer = [...activePlayers].sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())[0];
      nextMasterId = oldestPlayer.id;
    }

    if (nextMasterId && room.state_master_id !== nextMasterId && nextMasterId === currentPlayer.id) {
      // I am the new master, update DB
      supabase.from('rooms').update({ state_master_id: nextMasterId }).eq('id', room.id).then(({ error }) => {
        if (error) console.error("Error updating state master:", error);
      });
    }
  }, [players, room, currentRound, currentPlayer]);

  // Self-healing: If we somehow got stuck with phase='waiting' but status='playing'
  useEffect(() => {
    if (room?.current_phase === 'waiting' && room?.status === 'playing') {
      console.log("Auto-healing detected: DB/Local sync issue. Fixing local state and DB...");
      
      const fixRoom = async () => {
        try {
          const { error } = await supabase.from('rooms').update({ status: 'waiting' }).eq('id', room.id);
          if (error) {
            console.error("Auto-heal DB update failed:", error);
          } else {
            console.log("Auto-heal DB update success");
            useGameStore.setState({ room: { ...room, status: 'waiting' } });
          }
        } catch (err) {
          console.error("Auto-heal exception:", err);
        }
      };
      fixRoom();
    }
  }, [room?.current_phase, room?.status, room?.id]);

  if (!room || !currentPlayer) return null;

  switch (room.current_phase) {
    case 'spinning':
      return <SpinnerPhase currentRound={currentRound} />;
    case 'choosing_truth_dare':
      return <ChoosingPhase currentRound={currentRound} />;
    case 'discussion':
      return <DiscussionPhase currentRound={currentRound} />;
    case 'question_submission':
      return <QuestionPhase currentRound={currentRound} />;
    case 'answering':
      return <AnswerPhase currentRound={currentRound} />;
    case 'answer_review':
      return <AnswerReviewPhase currentRound={currentRound} />;
    case 'live_stream':
      return <LiveStreamPhase currentRound={currentRound} />;
    case 'voting':
      return <VotingPhase currentRound={currentRound} />;
    default:
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)]">
          <h2 className="text-2xl text-white">Current Phase: {room.current_phase}</h2>
          <p className="text-gray-400 mt-2">Next phase is loading... {room.current_phase === 'waiting' && '(Fixing stuck state...)'}</p>
        </div>
      );
  }
}
