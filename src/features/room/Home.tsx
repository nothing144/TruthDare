import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { generateRoomCode } from '../../utils/helpers';
import { useGameStore } from '../../store/useGameStore';
import { supabase } from '../../lib/supabase';
import { Loader2 } from 'lucide-react';

export default function Home() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { setCurrentPlayer, setRoom } = useGameStore();

  const handleCreateRoom = async () => {
    if (!name.trim()) {
      setError('Please enter your name first');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Create room with retry for code collision
      let roomData = null;
      let attempts = 0;
      while (!roomData && attempts < 5) {
        const code = generateRoomCode();
        const { data, error: roomError } = await supabase
          .from('rooms')
          .insert({
            room_code: code,
            status: 'waiting',
            current_round: 0,
            current_phase: 'waiting',
          })
          .select()
          .single();
        
        if (roomError) {
          // If it's a unique constraint violation, retry with a new code
          if (roomError.code === '23505') {
            attempts++;
            continue;
          }
          throw roomError;
        }
        roomData = data;
      }
      
      if (!roomData) throw new Error('Failed to generate a unique room code. Please try again.');
      
      // 2. Create Player
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .insert({
          room_id: roomData.id,
          name: name.trim(),
          score: 0,
          rank: 1,
          is_online: true,
          has_been_victim: false,
        })
        .select()
        .single();
        
      if (playerError) throw playerError;
      
      setRoom(roomData);
      setCurrentPlayer(playerData);
      
      navigate(`/room/${roomData.room_code}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!name.trim()) {
      setError('Please enter your name first');
      return;
    }
    if (!roomCode.trim() || roomCode.length !== 6) {
      setError('Please enter a valid 6-character room code');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // 1. Find Room
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .single();
        
      if (roomError || !roomData) throw new Error('Room not found');
      if (roomData.status !== 'waiting') throw new Error('Game already started or finished');
      
      // Check for duplicate names
      const { data: existingPlayers } = await supabase
        .from('players')
        .select('name')
        .eq('room_id', roomData.id);
      
      if (existingPlayers?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new Error('A player with that name is already in the room. Please choose a different name.');
      }
      
      // 2. Create Player
      const { data: playerData, error: playerError } = await supabase
        .from('players')
        .insert({
          room_id: roomData.id,
          name: name.trim(),
          score: 0,
          rank: 1,
          is_online: true,
          has_been_victim: false,
        })
        .select()
        .single();
        
      if (playerError) throw playerError;
      
      setRoom(roomData);
      setCurrentPlayer(playerData);
      
      navigate(`/room/${roomData.room_code}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)]">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.h1 
            className="text-5xl font-extrabold mb-2 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)]"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Truth or Dare
          </motion.h1>
          <p className="text-gray-400">The ultimate party game, now online.</p>
        </div>

        <div className="glass-panel p-8 rounded-2xl shadow-2xl flex flex-col gap-6 relative overflow-hidden">
          {/* Subtle glow effect behind the form */}
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-[var(--color-primary)] rounded-full blur-[80px] opacity-20 pointer-events-none"></div>
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-[var(--color-accent)] rounded-full blur-[80px] opacity-20 pointer-events-none"></div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 uppercase tracking-wider">Your Name</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full px-4 py-3 bg-black/40 border border-gray-700/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent transition-all text-white placeholder-gray-600"
              maxLength={20}
            />
          </div>

          {error && (
            <motion.p 
              initial={{ opacity: 0, height: 0 }} 
              animate={{ opacity: 1, height: 'auto' }} 
              className="text-red-400 text-sm font-medium text-center"
            >
              {error}
            </motion.p>
          )}

          <button 
            onClick={handleCreateRoom}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-[var(--color-primary)] hover:bg-[#9d1fee] text-white font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed box-glow-primary flex justify-center items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'Create Room'}
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-gray-700/50"></div>
            <span className="flex-shrink-0 mx-4 text-gray-500 text-sm">OR</span>
            <div className="flex-grow border-t border-gray-700/50"></div>
          </div>

          <div className="flex gap-2">
            <input 
              type="text" 
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              className="w-full px-4 py-3 bg-black/40 border border-gray-700/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all text-white text-center font-mono placeholder-gray-600 uppercase tracking-widest"
              maxLength={6}
            />
            <button 
              onClick={handleJoinRoom}
              disabled={loading || !roomCode}
              className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700"
            >
              Join
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
