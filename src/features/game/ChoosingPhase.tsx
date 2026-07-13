import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';

interface Props {
  currentRound: Round | null;
}

export default function ChoosingPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [timeLeft, setTimeLeft] = useState(10);
  
  const victim = players.find(p => p.id === currentRound?.victim_id);
  const isVictim = currentPlayer?.id === victim?.id;

  useEffect(() => {
    if (!currentRound || !room) return;

    const interval = setInterval(() => {
      const currentServerTime = Date.now() - serverTimeOffset;
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 10;
      
      const remaining = Math.ceil((startedAt + (duration * 1000) - currentServerTime) / 1000);

      // Add a 2-second tolerance window for network latency
      if (remaining <= -2) {
        if (room.state_master_id === currentPlayer?.id) {
          clearInterval(interval);
          setTimeLeft(0);
          handleTimeout();
        } else if (remaining <= -4) {
          clearInterval(interval);
          setTimeLeft(0);
          handleTimeout(true);
        } else {
          setTimeLeft(0);
        }
      } else {
        setTimeLeft(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [currentRound, room, serverTimeOffset]);

  const handleTimeout = async (forceFallback: boolean = false) => {
    if (!victim || !room || !currentRound) return;
    // Only the State Master (or fallback) executes timeout side-effects
    if (room.state_master_id !== currentPlayer?.id && !forceFallback) return;
    
    try {
      // Deduct 5 points
      await supabase.from('players').update({
        score: victim.score - 5
      }).eq('id', victim.id);
      
      // Cancel round and reset to lobby
      await supabase.from('rounds').update({ status: 'cancelled' }).eq('id', currentRound.id);
      await supabase.from('rooms').update({ status: 'waiting', current_phase: 'waiting' }).eq('id', room.id);
    } catch (err) {
      console.error('Timeout error:', err);
    }
  };

  const handleChoice = async (type: 'truth' | 'dare') => {
    if (!currentRound || !room || !victim) return;
    if (!isVictim) return; // Only the victim can choose
    
    try {
      // Update round type
      await supabase.from('rounds').update({ type }).eq('id', currentRound.id);
      
      // Mark victim as having been victim
      await supabase.from('players').update({ has_been_victim: true }).eq('id', victim.id);
      
      // Transition to discussion phase
      await supabase.from('rooms').update({ 
        current_phase: 'discussion',
        phase_started_at: Date.now(),
        phase_duration_seconds: 180
      }).eq('id', room.id);
    } catch (err) {
      console.error('Choice error:', err);
    }
  };

  if (!victim) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[var(--color-secondary)] rounded-full blur-[200px] opacity-10 pointer-events-none"></div>

      <div className="z-10 w-full max-w-xl text-center">
        <h2 className="text-4xl font-extrabold text-white mb-4 text-glow-primary">
          Truth or Dare?
        </h2>
        
        <div className="text-6xl font-mono text-[var(--color-accent)] font-bold mb-12 drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]">
          {timeLeft}s
        </div>

        {isVictim ? (
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleChoice('truth')}
              className="flex-1 py-8 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-800 text-white font-extrabold text-3xl shadow-[0_0_30px_rgba(79,70,229,0.5)] border border-indigo-400"
            >
              TRUTH
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleChoice('dare')}
              className="flex-1 py-8 rounded-2xl bg-gradient-to-br from-purple-600 to-[var(--color-primary)] text-white font-extrabold text-3xl shadow-[0_0_30px_rgba(176,38,255,0.5)] border border-purple-400"
            >
              DARE
            </motion.button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-8 rounded-2xl"
          >
            <p className="text-2xl font-bold text-gray-200">
              <span className="text-[var(--color-primary)]">{victim.name}</span> is deciding...
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-3 h-3 rounded-full bg-[var(--color-accent)]"></motion.div>
              <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-3 h-3 rounded-full bg-[var(--color-primary)]"></motion.div>
              <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-3 h-3 rounded-full bg-[var(--color-secondary)]"></motion.div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
