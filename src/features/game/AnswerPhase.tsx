import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';
import { Send, Clock, Video } from 'lucide-react';

interface Props {
  currentRound: Round | null;
}

export default function AnswerPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [finalQuestion, setFinalQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  const victim = players.find(p => p.id === currentRound?.victim_id);
  const isVictim = currentPlayer?.id === victim?.id;

  // Fetch final question
  useEffect(() => {
    if (!room || !currentRound) return;
    
    const fetchQuestion = async () => {
      const { data } = await supabase
        .from('messages')
        .select('message')
        .eq('room_id', room.id)
        .eq('phase', 'final_question')
        .gte('created_at', currentRound.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (data) {
        setFinalQuestion(data.message);
      }
    };
    
    fetchQuestion();
  }, [room?.id, currentRound?.id]);

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
  }, [room, currentRound, serverTimeOffset]);

  const handleTimeout = async (forceFallback: boolean = false) => {
    if (!victim || !room || !currentRound) return;
    // Only the State Master (or fallback) executes timeout side-effects
    if (room.state_master_id !== currentPlayer?.id && !forceFallback) return;
    
    try {
      // Deduct points for taking too long/disconnecting
      await supabase.from('players').update({ score: victim.score - 5 }).eq('id', victim.id);
      
      // Cancel round and go back to lobby
      await supabase.from('rounds').update({ status: 'cancelled' }).eq('id', currentRound.id);
      await supabase.from('rooms').update({ 
        status: 'waiting', 
        current_phase: 'waiting',
        state_master_id: null,
        phase_started_at: null,
        phase_duration_seconds: null,
        current_round_id: null
      }).eq('id', room.id);
    } catch (err) {
      console.error('Timeout error:', err);
    }
  };

  const submitTruthAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || !room || !currentPlayer) return;
    
    setSubmitting(true);
    try {
      await supabase.from('messages').insert({
        room_id: room.id,
        sender_id: currentPlayer.id,
        message: answer.trim(),
        phase: 'truth_answer'
      });

      // Move to review phase so players can discuss the answer
      await supabase.from('rooms').update({ 
        current_phase: 'answer_review',
        phase_started_at: Date.now(),
        phase_duration_seconds: 120
      }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const startDareStream = async () => {
    if (!room) return;
    try {
      await supabase.from('rooms').update({ 
        current_phase: 'live_stream',
        phase_started_at: Date.now(),
        phase_duration_seconds: 30
      }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    }
  };

  if (!victim || !currentRound) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--color-accent)] rounded-full blur-[250px] opacity-10 pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="z-10 w-full max-w-2xl glass-panel p-8 md:p-12 rounded-3xl"
      >
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl text-gray-400 font-bold uppercase tracking-widest">
            {currentRound.type === 'truth' ? 'The Truth' : 'The Dare'}
          </h2>
          <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 rounded-xl text-red-400 font-mono text-xl font-bold border border-red-500/20">
            <Clock size={20} />
            {timeLeft}s
          </div>
        </div>

        <div className="bg-black/40 rounded-2xl p-8 mb-8 border border-gray-700/50 shadow-inner text-center">
          <p className="text-gray-400 mb-2">Question for <span className="text-[var(--color-primary)] font-bold">{victim.name}</span>:</p>
          <h3 className="text-3xl font-extrabold text-white leading-tight">
            "{finalQuestion || 'Loading question...'}"
          </h3>
        </div>

        {isVictim ? (
          <div>
            {currentRound.type === 'truth' ? (
              <form onSubmit={submitTruthAnswer} className="flex flex-col gap-4">
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your honest answer here..."
                  className="w-full h-32 bg-gray-900 border border-gray-700 rounded-2xl p-4 text-white resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] transition-all text-lg"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!answer.trim() || submitting}
                  className="w-full py-4 rounded-xl bg-[var(--color-primary)] hover:bg-purple-600 text-white font-bold text-lg transition-all disabled:opacity-50 flex justify-center items-center gap-2 box-glow-primary"
                >
                  {submitting ? 'Submitting...' : 'Submit Answer'}
                  <Send size={20} />
                </button>
              </form>
            ) : (
              <div className="text-center">
                <p className="text-gray-300 mb-6 text-lg">You chose Dare! It's time to prove yourself on camera.</p>
                <button
                  onClick={startDareStream}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white font-bold text-xl transition-all flex justify-center items-center gap-3 shadow-[0_0_20px_rgba(6,182,212,0.4)]"
                >
                  <Video size={24} />
                  Start Live Stream
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-2xl font-bold text-gray-200">
              Waiting for <span className="text-[var(--color-primary)]">{victim.name}</span> to {currentRound.type === 'truth' ? 'answer' : 'start the stream'}...
            </p>
            <p className="text-gray-500 mt-2 text-sm">If they disconnect or time runs out, the round will restart.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
