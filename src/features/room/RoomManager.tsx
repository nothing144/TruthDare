import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useGameStore } from '../../store/useGameStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Copy, CheckCircle2, Play, AlertCircle } from 'lucide-react';
import { startNextRound } from '../game/gameLogic';
import GameManager from '../game/GameManager';
import toast from 'react-hot-toast';

export default function RoomManager() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { room, players, currentPlayer, setRoom, setPlayers, setServerTimeOffset } = useGameStore();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!roomCode) return;

    const fetchRoomAndPlayers = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('room_code', roomCode.toUpperCase())
          .single();

        if (roomError || !roomData) throw new Error('Room not found');
        
        // Compute offset between client time and server time
        const serverTime = new Date(roomData.last_activity).getTime();
        setServerTimeOffset(Date.now() - serverTime);
        
        setRoom(roomData);

        const { data: playersData, error: playersError } = await supabase
          .from('players')
          .select('*')
          .eq('room_id', roomData.id)
          .order('joined_at', { ascending: true });

        if (playersError) throw playersError;
        setPlayers(playersData || []);

        // Validate that the persisted currentPlayer still exists in this room
        if (!currentPlayer || !playersData?.some(p => p.id === currentPlayer.id)) {
          useGameStore.getState().setCurrentPlayer(null);
          useGameStore.getState().setRoom(null);
          navigate('/');
          return;
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Error loading room');
      } finally {
        setLoading(false);
      }
    };

    fetchRoomAndPlayers();

    if (room?.id) {
      const channel = supabase
        .channel(`room:${room.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${room.id}` },
          (payload: any) => {
            const state = useGameStore.getState();
            
            if (payload.eventType === 'INSERT') {
              if (payload.new.id !== state.currentPlayer?.id) {
                toast.success(`${payload.new.name} joined the room!`);
              }
            } else if (payload.eventType === 'UPDATE') {
              const oldPlayer = state.players.find(p => p.id === payload.new.id);
              if (oldPlayer) {
                if (oldPlayer.is_online && !payload.new.is_online) {
                  toast(`${payload.new.name} disconnected`, { icon: '⚠️' });
                }
                if (oldPlayer.score < payload.new.score) {
                  toast.success(`${payload.new.name} gained ${payload.new.score - oldPlayer.score} points!`);
                } else if (oldPlayer.score > payload.new.score) {
                  toast.error(`${payload.new.name} lost ${oldPlayer.score - payload.new.score} points.`);
                }
              }
            }
            
            fetchRoomAndPlayers(); 
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
          (payload) => { setRoom(payload.new as any); }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [roomCode, room?.id, currentPlayer, navigate, setRoom, setPlayers]);

  const copyRoomCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startGame = async () => {
    if (players.length < 3 || isStarting) return;
    setIsStarting(true);
    try {
      await startNextRound(room!, players);
    } catch (err) {
      console.error('Error starting game', err);
    } finally {
      setIsStarting(false);
    }
  };

  // Spinner turn calculation (must be before early returns to respect React hooks rules)
  const activePlayers = players.filter(p => p.is_online !== false);
  const sortedPlayers = [...activePlayers].sort((a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime());
  const currentRoundCount = room?.current_round || 0;
  const currentSpinner = sortedPlayers.length > 0 ? sortedPlayers[currentRoundCount % sortedPlayers.length] : null;
  const isMyTurn = currentSpinner?.id === currentPlayer?.id;

  useEffect(() => {
    if (room?.status === 'waiting' && isMyTurn && currentSpinner && players.length >= 3 && !isStarting) {
      toast(`It's your turn to spin!`, { icon: '🎲', id: 'turn-toast' });
    }
  }, [room?.status, isMyTurn, currentSpinner?.id, players.length, isStarting]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-background)] text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Oops!</h2>
        <p className="text-gray-400 mb-6">{error}</p>
        <button 
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold transition-all"
        >
          Go Home
        </button>
      </div>
    );
  }

  // If game started, render GameManager
  if (room?.status === 'playing') {
    return <GameManager />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6 bg-[var(--color-background)]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg mt-10"
      >
        <div className="glass-panel p-8 rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--color-secondary)] rounded-full blur-[100px] opacity-10 pointer-events-none"></div>
          
          <div className="text-center mb-8">
            <h2 className="text-sm font-bold tracking-widest text-gray-400 uppercase mb-2">Room Code</h2>
            <div 
              onClick={copyRoomCode}
              className="inline-flex items-center gap-3 bg-black/40 px-6 py-3 rounded-xl border border-gray-700/50 cursor-pointer hover:border-[var(--color-primary)] transition-colors group"
            >
              <span className="text-4xl font-mono font-bold tracking-widest text-white group-hover:text-[var(--color-primary)] transition-colors">
                {room?.room_code}
              </span>
              {copied ? <CheckCircle2 className="text-green-500" /> : <Copy className="text-gray-500 group-hover:text-white" />}
            </div>
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Users className="text-[var(--color-accent)]" />
                {room?.status === 'finished' ? 'Final Leaderboard' : 'Players'}
              </h3>
              <span className="text-sm font-medium px-3 py-1 bg-gray-800 rounded-full">
                {players.length} / 10
              </span>
            </div>

            <div className="space-y-3">
              <AnimatePresence>
                {[...players].sort((a, b) => b.score - a.score).map((p, index) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`p-4 rounded-xl flex justify-between items-center ${
                      p.id === currentPlayer?.id 
                        ? 'bg-[var(--color-primary)]/20 border border-[var(--color-primary)]/50' 
                        : 'bg-black/40 border border-gray-700/50'
                    } ${room?.status === 'finished' && index === 0 ? 'ring-2 ring-yellow-400 box-glow-accent' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      {room?.status === 'finished' && (
                        <div className="text-2xl font-bold text-gray-500 w-6 text-center">
                          {index === 0 ? '👑' : `#${index + 1}`}
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-lg flex items-center gap-2">
                          {p.name} {p.id === currentPlayer?.id && <span className="text-xs bg-[var(--color-primary)] text-white px-2 py-0.5 rounded-full">You</span>}
                        </span>
                        <span className="text-sm font-mono text-[var(--color-primary)]">Score: {p.score}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${p.is_online ? 'bg-green-500 box-glow-accent' : 'bg-gray-500'}`}></div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {players.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  Waiting for players to join...
                </div>
              )}
            </div>
          </div>

          <div className="mt-8">
            {room?.status === 'finished' ? (
              <div className="text-center p-6 bg-green-500/10 border border-green-500/20 rounded-xl">
                <h3 className="text-2xl font-bold text-green-400 mb-2">Game Over!</h3>
                <p className="text-gray-300">Everyone has taken a turn. Thanks for playing!</p>
                <button 
                  onClick={() => navigate('/')}
                  className="mt-6 w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold transition-all"
                >
                  Return to Home
                </button>
              </div>
            ) : players.length < 3 ? (
              <div className="text-center p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <p className="text-yellow-500 text-sm font-medium">Waiting for at least 3 players to start.</p>
              </div>
            ) : isMyTurn ? (
              <button 
                onClick={startGame}
                disabled={players.length > 10 || isStarting}
                className={`w-full py-4 rounded-xl text-white font-bold text-lg transition-all flex justify-center items-center gap-2 ${
                  isStarting 
                    ? 'bg-gray-600 opacity-50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] hover:opacity-90 transform hover:scale-[1.02] active:scale-[0.98] box-glow-primary'
                }`}
              >
                {isStarting ? (
                  <div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Play fill="currentColor" size={20} />
                )}
                {isStarting ? 'Starting...' : 'Spin Bottle'}
              </button>
            ) : (
              <div className="text-center p-6 bg-black/40 border border-gray-700/50 rounded-xl flex flex-col items-center gap-4">
                <div className="w-8 h-8 border-4 border-gray-600 border-t-[var(--color-primary)] rounded-full animate-spin"></div>
                <div>
                  <p className="text-gray-400 text-sm mb-1">Waiting for</p>
                  <p className="text-[var(--color-primary)] font-bold text-xl">{currentSpinner?.name}</p>
                  <p className="text-gray-400 text-sm mt-1">to spin the bottle...</p>
                </div>
              </div>
            )}
            {players.length > 10 && (
              <p className="text-red-400 text-sm text-center mt-2">Maximum 10 players allowed.</p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
