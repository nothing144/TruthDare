import { useEffect, useState, useRef, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';
import { Send, Clock, FastForward } from 'lucide-react';

interface Props {
  currentRound: Round | null;
}

export default function AnswerReviewPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes
  const [finalQuestion, setFinalQuestion] = useState('');
  const [truthAnswer, setTruthAnswer] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const victim = players.find(p => p.id === currentRound?.victim_id);
  const questioner = players.find(p => p.id === currentRound?.questioner_id);
  const isQuestioner = currentPlayer?.id === questioner?.id;

  // Fetch final question and answer
  useEffect(() => {
    if (!room || !currentRound) return;
    
    const fetchData = async () => {
      // Question
      const { data: qData } = await supabase
        .from('messages')
        .select('message')
        .eq('room_id', room.id)
        .eq('phase', 'final_question')
        .gte('created_at', currentRound!.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (qData) setFinalQuestion(qData.message);

      // Answer
      const { data: aData } = await supabase
        .from('messages')
        .select('message')
        .eq('room_id', room.id)
        .eq('phase', 'truth_answer')
        .gte('created_at', currentRound!.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (aData) setTruthAnswer(aData.message);
    };
    
    fetchData();
  }, [room?.id, currentRound?.id]);

  // Timer Logic
  useEffect(() => {
    if (!room || !currentRound) return;

    const interval = setInterval(() => {
      const currentServerTime = Date.now() - serverTimeOffset;
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 120;
      
      const remaining = Math.ceil((startedAt + (duration * 1000) - currentServerTime) / 1000);

      // Add a 2-second tolerance window for network latency
      if (remaining <= -2) {
        clearInterval(interval);
        setTimeLeft(0);
        handleEndReview();
      } else {
        setTimeLeft(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, currentRound, serverTimeOffset]);

  // Chat Subscription Logic
  useEffect(() => {
    if (!room) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', room.id)
        .eq('phase', 'answer_review')
        .gte('created_at', currentRound!.created_at)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    };

    fetchMessages();

    const channel = supabase
      .channel(`review_chat:${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room.id}` },
        (payload) => {
          setMessages(prev => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleEndReview = async () => {
    if (!room) return;
    try {
      await supabase.from('rooms').update({ 
        current_phase: 'voting',
        phase_started_at: Date.now(),
        phase_duration_seconds: 60
      }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !room || !currentPlayer) return;

    const msg = newMessage.trim();
    setNewMessage('');

    await supabase.from('messages').insert({
      room_id: room.id,
      sender_id: currentPlayer.id,
      message: msg,
      phase: 'answer_review'
    });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!victim || !questioner) return null;

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-8 bg-[var(--color-background)] h-screen">
      <div className="max-w-4xl w-full mx-auto h-full flex flex-col glass-panel rounded-3xl overflow-hidden shadow-2xl border border-gray-800">
        
        {/* Header - Question & Answer Display */}
        <div className="bg-black/60 p-6 border-b border-gray-800 z-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--color-primary)] rounded-full blur-[100px] opacity-10 pointer-events-none"></div>
          
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Answer Review
            </h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-[var(--color-accent)] font-mono text-lg font-bold bg-[var(--color-accent)]/10 px-3 py-1 rounded-lg">
                <Clock size={18} />
                {formatTime(timeLeft)}
              </div>
              {isQuestioner && (
                <button 
                  onClick={handleEndReview}
                  className="flex items-center gap-2 bg-[var(--color-primary)] hover:bg-purple-600 px-4 py-2 rounded-xl text-white font-bold transition-all text-sm"
                >
                  <FastForward size={16} />
                  Start Voting
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-900/50 p-4 rounded-xl border border-gray-700/50">
              <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Question from {questioner.name}</p>
              <p className="text-white italic">"{finalQuestion || 'Loading...'}"</p>
            </div>
            
            <div className="bg-[var(--color-primary)]/10 p-4 rounded-xl border border-[var(--color-primary)]/30">
              <p className="text-xs text-[var(--color-primary)] uppercase font-bold tracking-wider mb-1">Answer from {victim.name}</p>
              <p className="text-white font-medium text-lg">"{truthAnswer || 'Loading...'}"</p>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-black/20">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center">
              <p>Discuss the answer!</p>
              <p className="text-sm">Did {victim.name} tell the complete truth?</p>
            </div>
          ) : (
            messages.map((msg) => {
              const sender = players.find(p => p.id === msg.sender_id);
              const isMe = msg.sender_id === currentPlayer?.id;
              
              return (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id} 
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-xs text-gray-500 mb-1 ml-1">{sender?.name || 'Unknown'}</span>
                  <div className={`px-4 py-2 rounded-2xl max-w-[80%] ${
                    isMe 
                      ? 'bg-[var(--color-primary)] text-white rounded-br-none' 
                      : 'bg-gray-800 text-gray-200 rounded-bl-none'
                  }`}>
                    {msg.message}
                  </div>
                </motion.div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <form onSubmit={sendMessage} className="p-4 bg-black/60 border-t border-gray-800 flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
            maxLength={200}
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="bg-[var(--color-primary)] text-white p-3 rounded-xl hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
