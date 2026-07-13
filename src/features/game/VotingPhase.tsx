import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';
import { ThumbsUp, ThumbsDown, Loader, Clock } from 'lucide-react';
import { startNextRound } from './gameLogic';

interface Props {
  currentRound: Round | null;
}

export default function VotingPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [votes, setVotes] = useState<any[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [outcome, setOutcome] = useState<'success' | 'fail' | null>(null);
  const [timeLeft, setTimeLeft] = useState(60);

  const victim = players.find(p => p.id === currentRound?.victim_id);
  const isVictim = currentPlayer?.id === victim?.id;

  // Fetch and subscribe to votes
  useEffect(() => {
    if (!room || !currentRound) return;

    const fetchVotes = async () => {
      const { data } = await supabase
        .from('votes')
        .select('*')
        .eq('round_id', currentRound.id);
      if (data) {
        setVotes(data);
        if (data.some(v => v.player_id === currentPlayer?.id)) {
          setHasVoted(true);
        }
      }
    };

    fetchVotes();

    const channel = supabase
      .channel(`votes:${currentRound.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'votes', filter: `round_id=eq.${currentRound.id}` },
        (payload) => {
          setVotes(prev => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, currentRound?.id, currentPlayer?.id]);

  // Timer logic
  useEffect(() => {
    if (!room || !currentRound) return;

    const interval = setInterval(() => {
      const currentServerTime = Date.now() - serverTimeOffset;
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 60;
      
      const remaining = Math.ceil((startedAt + (duration * 1000) - currentServerTime) / 1000);

      // Add a 2-second tolerance window for network latency
      if (remaining <= -2) {
        // Force tally on timeout
        if (room.state_master_id === currentPlayer?.id) {
          clearInterval(interval);
          setTimeLeft(0);
          if (outcome === null) tallyVotes();
        } else if (remaining <= -4) {
          // Fallback if state master is asleep
          clearInterval(interval);
          setTimeLeft(0);
          if (outcome === null) tallyVotes(true);
        } else {
          setTimeLeft(0);
        }
      } else {
        setTimeLeft(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, currentRound, serverTimeOffset, outcome]);

  // Tally votes when everyone has voted
  useEffect(() => {
    if (!room || !currentRound || !victim) return;

    // Expected votes: everyone except the victim
    const expectedVotes = players.length - 1;
    
    if (votes.length >= expectedVotes && expectedVotes > 0 && outcome === null) {
      tallyVotes();
    }
  }, [votes.length, players.length, outcome]);

  const tallyVotes = async (forceFallback: boolean = false) => {
    if (!room || !currentRound || !victim || outcome !== null) return;
    
    // Fetch fresh votes from DB to avoid stale closure issues
    const { data: freshVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('round_id', currentRound.id);
    
    const allVotes = freshVotes || [];
    const yesVotes = allVotes.filter(v => v.vote === true).length;
    const noVotes = allVotes.filter(v => v.vote === false).length;
    
    const success = yesVotes >= noVotes;
    setOutcome(success ? 'success' : 'fail');

    // Only the State Master (or fallback) executes the final DB updates to prevent race conditions
    const isStateMaster = room.state_master_id === currentPlayer?.id;

    if (isStateMaster || forceFallback) {
      const scoreDelta = success ? 10 : -10;
      
      // Update score
      await supabase.from('players').update({ score: victim.score + scoreDelta }).eq('id', victim.id);
      
      // Mark round finished
      await supabase.from('rounds').update({ 
        status: 'completed',
        ended_at: new Date().toISOString()
      }).eq('id', currentRound.id);

      // Wait 5 seconds to show outcome, then go back to lobby
      setTimeout(async () => {
        await supabase.from('rooms').update({ 
          status: 'waiting',
          current_phase: 'waiting', 
          state_master_id: null,
          phase_started_at: null,
          phase_duration_seconds: null,
          current_round_id: null
        }).eq('id', room.id);
      }, 5000);
    }
  };

  const castVote = async (vote: boolean) => {
    if (!currentRound || !currentPlayer) return;
    
    setHasVoted(true);
    const { error } = await supabase.from('votes').insert({
      room_id: room?.id,
      round_id: currentRound.id,
      player_id: currentPlayer.id,
      vote
    });
    if (error) {
      console.error('Vote error:', error);
      setHasVoted(false);
    }
  };

  if (!victim || !currentRound) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[250px] opacity-10 pointer-events-none transition-colors duration-1000 ${outcome === 'success' ? 'bg-green-500' : outcome === 'fail' ? 'bg-red-500' : 'bg-purple-500'}`}></div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="z-10 w-full max-w-2xl glass-panel p-8 md:p-12 rounded-3xl text-center border border-gray-800 shadow-2xl"
      >
        {outcome ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-8"
          >
            <h2 className={`text-5xl font-extrabold mb-6 ${outcome === 'success' ? 'text-green-400' : 'text-red-500'}`}>
              {outcome === 'success' ? 'SUCCESS!' : 'FAILED!'}
            </h2>
            <p className="text-xl text-gray-300 mb-8">
              {outcome === 'success' 
                ? `${victim.name} earned 10 points for completing the ${currentRound.type}!`
                : `${victim.name} lost 10 points for failing the ${currentRound.type}.`}
            </p>
            <div className="flex justify-center items-center gap-3 text-gray-500">
              <Loader className="animate-spin" size={20} />
              <p>Returning to Lobby...</p>
            </div>
          </motion.div>
        ) : (
          <>
            <div className="flex items-center gap-2 justify-center bg-black/40 px-4 py-2 rounded-xl text-[var(--color-accent)] font-mono text-xl font-bold border border-gray-700/50 w-max mx-auto mb-6">
              <Clock size={20} />
              {timeLeft}s
            </div>
            
            <h2 className="text-3xl font-extrabold text-white mb-2">Voting Phase</h2>
            <p className="text-gray-400 mb-8">Did <span className="text-[var(--color-primary)] font-bold">{victim.name}</span> complete the {currentRound.type}?</p>

            {isVictim ? (
              <div className="py-12 bg-black/40 rounded-2xl border border-gray-800">
                <p className="text-2xl font-bold text-gray-300">
                  The group is voting on your fate...
                </p>
                <p className="text-gray-500 mt-4">
                  {votes.length} / {players.length - 1} votes cast
                </p>
              </div>
            ) : hasVoted ? (
              <div className="py-12 bg-black/40 rounded-2xl border border-gray-800">
                <p className="text-2xl font-bold text-[var(--color-primary)]">
                  Vote Cast!
                </p>
                <p className="text-gray-400 mt-4">
                  Waiting for others... ({votes.length} / {players.length - 1})
                </p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-6 justify-center">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => castVote(true)}
                  className="flex-1 py-8 rounded-2xl bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 font-extrabold text-2xl shadow-[0_0_30px_rgba(34,197,94,0.2)] flex flex-col items-center gap-3 transition-all"
                >
                  <ThumbsUp size={40} />
                  YES
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => castVote(false)}
                  className="flex-1 py-8 rounded-2xl bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 font-extrabold text-2xl shadow-[0_0_30px_rgba(239,68,68,0.2)] flex flex-col items-center gap-3 transition-all"
                >
                  <ThumbsDown size={40} />
                  NO
                </motion.button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
