import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round, Player } from '../../types';
import { supabase } from '../../lib/supabase';
import { Send, Clock, FastForward } from 'lucide-react';

interface Props {
  currentRound: Round | null;
}

export default function DiscussionPhase({ currentRound }: Props) {
  const { room, players, currentPlayer } = useGameStore();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(180); // 3 minutes
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const victim = players.find(p => p.id === currentRound?.victim_id);
  const questioner = players.find(p => p.id === currentRound?.questioner_id);
  const isVictim = currentPlayer?.id === victim?.id;
  const isQuestioner = currentPlayer?.id === questioner?.id;

  // Timer & Transition Logic (server-time synced)
  useEffect(() => {
    if (!room || !currentRound) return;

    const interval = setInterval(() => {
      const currentServerTime = Date.now() - (useGameStore.getState().serverTimeOffset || 0);
      const startedAt = room.phase_started_at || currentServerTime;
      const duration = room.phase_duration_seconds || 180;
      
      const remaining = Math.ceil((startedAt + (duration * 1000) - currentServerTime) / 1000);

      if (remaining <= -2) {
        // Only the State Master triggers the timeout transition immediately
        if (room.state_master_id === currentPlayer?.id) {
          clearInterval(interval);
          setTimeLeft(0);
          handleEndDiscussion();
        } else if (remaining <= -4) {
          // Fallback if state master is asleep
          clearInterval(interval);
          setTimeLeft(0);
          handleEndDiscussion();
        } else {
          setTimeLeft(0);
        }
      } else {
        setTimeLeft(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, currentRound, currentPlayer?.id]);

  // Chat Subscription Logic
  useEffect(() => {
    if (!room || !currentRound || isVictim) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', room.id)
        .eq('phase', 'discussion')
        .gte('created_at', currentRound.created_at)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    };

    fetchMessages();

    const channel = supabase
      .channel(`chat:${room.id}`)
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
  }, [room?.id, isVictim]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleEndDiscussion = async () => {
    if (!room) return;
    await supabase.from('rooms').update({ current_phase: 'question_submission' }).eq('id', room.id);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !room || !currentPlayer) return;

    const msg = newMessage.trim();
    setNewMessage('');

    await supabase.from('messages').insert({
      room_id: room.id,
      sender_id: currentPlayer.id,
      message: msg,
      phase: 'discussion'
    });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!victim || !questioner) return null;

  if (isVictim) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] overflow-hidden relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--color-secondary)] rounded-full blur-[200px] opacity-10 pointer-events-none"></div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center z-10 glass-panel p-12 rounded-3xl"
        >
          <Clock className="w-16 h-16 text-[var(--color-primary)] mx-auto mb-6 animate-pulse" />
          <h2 className="text-3xl font-bold text-white mb-4">Please Wait...</h2>
          <p className="text-xl text-gray-300 max-w-md mx-auto leading-relaxed">
            The group is discussing what {currentRound?.type === 'dare' ? 'Dare' : 'Truth'} to give you.
          </p>
          <div className="mt-8 text-4xl font-mono text-[var(--color-accent)] font-bold">
            {formatTime(timeLeft)}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-8 bg-[var(--color-background)] h-screen">
      <div className="max-w-4xl w-full mx-auto h-full flex flex-col glass-panel rounded-3xl overflow-hidden shadow-2xl border border-gray-800">
        {/* Header */}
        <div className="bg-black/60 p-4 border-b border-gray-800 flex justify-between items-center z-10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Discussion Phase <span className="text-xs bg-[var(--color-primary)] px-2 py-1 rounded-full">{currentRound?.type?.toUpperCase()}</span>
            </h2>
            <p className="text-sm text-gray-400">
              Deciding a {currentRound?.type} for <span className="text-[var(--color-accent)] font-semibold">{victim.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[var(--color-accent)] font-mono text-xl font-bold bg-[var(--color-accent)]/10 px-4 py-2 rounded-xl">
              <Clock size={20} />
              {formatTime(timeLeft)}
            </div>
            {isQuestioner && (
              <button 
                onClick={handleEndDiscussion}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:bg-purple-600 px-4 py-2 rounded-xl text-white font-bold transition-all"
              >
                <FastForward size={18} />
                Ready
              </button>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-black/20">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center">
              <p>No messages yet.</p>
              <p className="text-sm">Start discussing the {currentRound?.type}!</p>
              {isQuestioner && (
                <p className="text-sm mt-4 text-[var(--color-primary)]">You have the final say and will write the question.</p>
              )}
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
