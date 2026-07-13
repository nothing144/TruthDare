import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';
import { Send, Clock } from 'lucide-react';

interface Props {
  currentRound: Round | null;
}

export default function QuestionPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [question, setQuestion] = useState('');
  const [timeLeft, setTimeLeft] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const victim = players.find(p => p.id === currentRound?.victim_id);
  const questioner = players.find(p => p.id === currentRound?.questioner_id);
  const isQuestioner = currentPlayer?.id === questioner?.id;

  useEffect(() => {
    if (!room || !currentRound || !questioner) return;

    const interval = setInterval(() => {
      const currentServerTime = Date.now() - serverTimeOffset;
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 30;
      
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
  }, [room, currentRound, questioner, serverTimeOffset]);

  const handleTimeout = async (forceFallback: boolean = false) => {
    if (!room || !currentRound || !questioner) return;
    // Only the State Master (or fallback) executes timeout side-effects
    if (room.state_master_id !== currentPlayer?.id && !forceFallback) return;

    // Pick a new questioner: anyone except the victim and current questioner
    const candidates = players.filter(p => p.id !== currentRound.victim_id && p.id !== questioner.id);
    if (candidates.length === 0) return;
    const newQuestioner = candidates[Math.floor(Math.random() * candidates.length)];

    await supabase.from('rounds').update({ questioner_id: newQuestioner.id }).eq('id', currentRound.id);
    await supabase.from('rooms').update({ 
      phase_started_at: Date.now(),
      state_master_id: newQuestioner.id
    }).eq('id', room.id);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !room || !currentRound) return;
    
    setSubmitting(true);
    try {
      // 1. Save the question as a message (or we can just store it in rounds, but the schema doesn't have a specific field for it).
      // We'll store it in messages table with phase = 'final_question'
      await supabase.from('messages').insert({
        room_id: room.id,
        sender_id: currentPlayer!.id,
        message: question.trim(),
        phase: 'final_question'
      });

      // 2. Transition to Answer Phase
      await supabase.from('rooms').update({ 
        current_phase: 'answering',
        phase_started_at: Date.now(),
        phase_duration_seconds: 60
      }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!victim || !questioner || !currentRound) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--color-primary)] rounded-full blur-[250px] opacity-10 pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="z-10 w-full max-w-xl glass-panel p-8 rounded-3xl text-center"
      >
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-2 bg-black/40 px-4 py-2 rounded-xl text-[var(--color-accent)] font-mono text-2xl font-bold border border-gray-700/50">
            <Clock size={24} />
            {timeLeft}s
          </div>
        </div>

        {isQuestioner ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div>
              <h2 className="text-3xl font-extrabold text-white mb-2">Write the {currentRound.type}!</h2>
              <p className="text-gray-400">You have the power. Give <span className="text-[var(--color-primary)] font-bold">{victim.name}</span> their final {currentRound.type}.</p>
            </div>
            
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Type your ${currentRound.type} here...`}
              className="w-full h-32 bg-gray-900/80 border border-gray-700 rounded-2xl p-4 text-white resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all text-lg"
              autoFocus
            />

            <button
              type="submit"
              disabled={!question.trim() || submitting}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] hover:opacity-90 text-white font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 box-glow-primary"
            >
              {submitting ? 'Submitting...' : 'Submit Question'}
              <Send size={20} />
            </button>
          </form>
        ) : (
          <div className="py-12">
            <h2 className="text-2xl font-bold text-gray-200 mb-6">
              Only <span className="text-[var(--color-primary)] text-3xl mx-2">{questioner.name}</span> can submit the final question.
            </h2>
            <div className="flex justify-center gap-3">
              <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }} className="w-3 h-3 rounded-full bg-[var(--color-accent)]"></motion.div>
              <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-3 h-3 rounded-full bg-[var(--color-primary)]"></motion.div>
              <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-3 h-3 rounded-full bg-[var(--color-secondary)]"></motion.div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
