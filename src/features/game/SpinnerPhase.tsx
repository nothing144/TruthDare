import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';

interface Props {
  currentRound: Round | null;
}

export default function SpinnerPhase({ currentRound }: Props) {
  const { room, players, currentPlayer } = useGameStore();
  const [spinning, setSpinning] = useState(true);

  // The victim and questioner to show
  const victim = players.find(p => p.id === currentRound?.victim_id);
  const questioner = players.find(p => p.id === currentRound?.questioner_id);

  useEffect(() => {
    if (!currentRound || !room) return;

    const interval = setInterval(async () => {
      const currentServerTime = Date.now() - (useGameStore.getState().serverTimeOffset || 0);
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 5;
      
      const remaining = Math.ceil((startedAt + (duration * 1000) - currentServerTime) / 1000);

      if (remaining <= 0) {
        setSpinning(false);
      }

      // After spin ends + 2s reveal, State Master transitions
      if (remaining <= -2 && room.state_master_id === currentPlayer?.id) {
        console.log('[DEBUG] SpinnerPhase transition triggered by State Master');
        clearInterval(interval);
        try {
          const res = await supabase.from('rooms').update({
            current_phase: 'choosing_truth_dare',
            phase_started_at: Date.now() - (useGameStore.getState().serverTimeOffset || 0),
            phase_duration_seconds: 10
          }).eq('id', room.id);
          console.log('[DEBUG] SpinnerPhase update result:', res);
        } catch (err) {
          console.error('[DEBUG] SpinnerPhase update error:', err);
        }
      } else if (remaining <= -4) {
        console.log('[DEBUG] SpinnerPhase fallback transition triggered');
        // Fallback: anyone can transition to prevent game getting stuck
        clearInterval(interval);
        try {
          const res = await supabase.from('rooms').update({
            current_phase: 'choosing_truth_dare',
            phase_started_at: Date.now() - (useGameStore.getState().serverTimeOffset || 0),
            phase_duration_seconds: 10
          }).eq('id', room.id);
          console.log('[DEBUG] SpinnerPhase fallback result:', res);
        } catch (err) {
          console.error('[DEBUG] SpinnerPhase fallback error:', err);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [currentRound, room, currentPlayer?.id]);

  if (!victim) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-[150px] opacity-10 pointer-events-none"></div>

      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-extrabold text-white mb-16 text-glow-primary z-10 text-center"
      >
        {spinning ? "Spinning the Wheel..." : "The Victim is..."}
      </motion.h2>

      <div className="relative w-72 h-72 flex items-center justify-center z-10">
        {/* The Spinner Circle */}
        <motion.div
          className="absolute inset-0 rounded-full border-[6px] border-[var(--color-surface-hover)]"
          animate={{ rotate: spinning ? 1800 : 0 }}
          transition={{ duration: 5, ease: "circOut" }}
          style={{
            background: 'conic-gradient(from 0deg, var(--color-primary), var(--color-accent), var(--color-primary))',
            boxShadow: '0 0 40px rgba(176,38,255,0.4)'
          }}
        >
          {/* Inner circle mask */}
          <div className="absolute inset-3 bg-[var(--color-surface)] rounded-full flex items-center justify-center shadow-inner">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-background)] opacity-50"></div>
          </div>
        </motion.div>

        {/* The Pointer */}
        <div className="absolute -top-6 w-0 h-0 border-l-[20px] border-r-[20px] border-t-[40px] border-l-transparent border-r-transparent border-t-[var(--color-accent)] z-20 filter drop-shadow-[0_0_12px_rgba(0,240,255,0.8)] transform origin-bottom"></div>

        {/* The Name in the center */}
        <div className="z-30 text-center px-4 max-w-[200px] break-words">
          {spinning ? (
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 0.2 }}
              className="text-3xl font-bold text-gray-500"
            >
              ???
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', bounce: 0.6, duration: 0.8 }}
              className="text-4xl font-extrabold text-white text-glow-accent drop-shadow-2xl"
            >
              {victim.name}
            </motion.div>
          )}
        </div>
      </div>

      {!spinning && questioner && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-16 text-2xl font-medium text-gray-300 text-center z-10 space-y-2"
        >
          <p>
            <span className="text-[var(--color-primary)] font-bold">{questioner.name}</span> will ask the question!
          </p>
          <p>
            {currentPlayer?.id === victim.id
              ? <span className="text-[var(--color-accent)] font-bold">Get ready to choose...</span>
              : `${victim.name} is choosing Truth or Dare...`}
          </p>
        </motion.div>
      )}
    </div>
  );
}
