import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../../store/useGameStore';
import type { Round } from '../../types';
import { supabase } from '../../lib/supabase';
import { Clock, Video, VideoOff, CheckCircle } from 'lucide-react';
import { useWebRTC } from '../../hooks/useWebRTC';

interface Props {
  currentRound: Round | null;
}

export default function LiveStreamPhase({ currentRound }: Props) {
  const { room, players, currentPlayer, serverTimeOffset } = useGameStore();
  const [timeLeft, setTimeLeft] = useState(30); 
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const victim = players.find(p => p.id === currentRound?.victim_id);
  const questioner = players.find(p => p.id === currentRound?.questioner_id);
  const isVictim = currentPlayer?.id === victim?.id;
  const isQuestioner = currentPlayer?.id === questioner?.id;

  const { localStream, startCamera } = useWebRTC({
    roomId: room?.id || '',
    isVictim,
    onRemoteStream: (stream) => {
      setRemoteStream(stream);
    }
  });

  useEffect(() => {
    if (isVictim && !localStream && !cameraError) {
      startCamera().catch(err => {
        setCameraError('Please allow camera access to complete the dare.');
      });
    }
  }, [isVictim, localStream, cameraError, startCamera]);

  useEffect(() => {
    if (videoRef.current) {
      if (isVictim && localStream) {
        videoRef.current.srcObject = localStream;
      } else if (!isVictim && remoteStream) {
        videoRef.current.srcObject = remoteStream;
      }
    }
  }, [isVictim, localStream, remoteStream]);

  // When stream starts, victim extends timer to 300 seconds
  useEffect(() => {
    if (isVictim && localStream && room?.phase_duration_seconds === 30) {
      supabase.from('rooms').update({
        phase_started_at: Date.now() - serverTimeOffset,
        phase_duration_seconds: 300
      }).eq('id', room.id).then(({ error }) => {
        if (error) console.error("Error updating stream duration:", error);
      });
    }
  }, [isVictim, localStream, room?.id, room?.phase_duration_seconds]);

  const hasStreamStarted = room?.phase_duration_seconds === 300;
  const timeElapsed = room?.phase_started_at ? ((Date.now() - serverTimeOffset) - room.phase_started_at) / 1000 : 0;
  const canFinishDare = hasStreamStarted && timeElapsed >= 60;

  // Timer logic
  useEffect(() => {
    if (!room || !currentRound) return;

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
          if (room.phase_duration_seconds === 30) handleDareFail();
          else handleDareComplete();
        } else if (remaining <= -4) {
          // Fallback if state master is asleep
          clearInterval(interval);
          setTimeLeft(0);
          if (room.phase_duration_seconds === 30) handleDareFail(true);
          else handleDareComplete(true);
        } else {
          setTimeLeft(0);
        }
      } else {
        setTimeLeft(Math.max(0, remaining));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, currentRound, serverTimeOffset]);

  const handleDareFail = async (forceFallback: boolean = false) => {
    if (!room || !victim || !currentRound) return;
    if (room.state_master_id !== currentPlayer?.id && !forceFallback) return;
    try {
      await supabase.from('players').update({ score: victim.score - 5 }).eq('id', victim.id);
      await supabase.from('rounds').update({ status: 'cancelled' }).eq('id', currentRound.id);
      
      // Go to voting anyway? Or just cancel round and spin again?
      // Since dare failed, they lose points, let's just go back to lobby/spinning
      await supabase.from('rooms').update({ status: 'waiting', current_phase: 'waiting' }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDareComplete = async (forceFallback: boolean = false) => {
    if (!room) return;
    if (room.state_master_id !== currentPlayer?.id && !forceFallback) return;
    try {
      await supabase.from('rooms').update({ 
        current_phase: 'voting',
        phase_started_at: Date.now() - serverTimeOffset,
        phase_duration_seconds: 60
      }).eq('id', room.id);
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!victim || !questioner) return null;

  return (
    <div className="min-h-screen flex flex-col p-4 sm:p-8 bg-black h-screen overflow-hidden">
      <div className="max-w-5xl w-full mx-auto h-full flex flex-col glass-panel rounded-3xl overflow-hidden shadow-2xl border border-gray-800 relative">
        
        {/* Header */}
        <div className="bg-black/60 p-4 border-b border-gray-800 flex justify-between items-center z-10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="animate-pulse w-3 h-3 bg-red-500 rounded-full inline-block"></span>
              LIVE DARE
            </h2>
            <p className="text-sm text-gray-400">
              {isVictim ? 'You are' : <span className="text-[var(--color-primary)] font-bold">{victim.name}</span>} performing the dare!
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-red-400 font-mono text-xl font-bold bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-xl">
              <Clock size={20} />
              {formatTime(timeLeft)}
            </div>
            {isQuestioner && (
              <button 
                onClick={() => handleDareComplete()}
                disabled={!canFinishDare}
                title={!hasStreamStarted ? "Waiting for stream..." : !canFinishDare ? "Must wait 60s" : "Finish Dare"}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-white font-bold transition-all ${
                  canFinishDare 
                    ? "bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] hover:opacity-90 shadow-[0_0_15px_rgba(176,38,255,0.4)]" 
                    : "bg-gray-600 opacity-50 cursor-not-allowed"
                }`}
              >
                <CheckCircle size={18} />
                Finish Dare
              </button>
            )}
          </div>
        </div>

        {/* Video Area */}
        <div className="flex-1 bg-black relative flex items-center justify-center">
          {cameraError ? (
            <div className="text-center text-red-500 p-8">
              <VideoOff size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-xl">{cameraError}</p>
            </div>
          ) : (isVictim && !localStream) || (!isVictim && !remoteStream) ? (
            <div className="text-center text-gray-500 flex flex-col items-center">
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                <Video size={48} className="mb-4 text-[var(--color-primary)] opacity-50" />
              </motion.div>
              <p className="text-xl">Connecting secure feed...</p>
              {!isVictim && <p className="text-sm mt-2">Waiting for {victim.name}'s camera... ({timeLeft}s left to start)</p>}
            </div>
          ) : null}

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isVictim} // Mute local video to prevent echo
            className={`w-full h-full object-cover transition-opacity duration-500 ${(isVictim && localStream) || (!isVictim && remoteStream) ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      </div>
    </div>
  );
}
