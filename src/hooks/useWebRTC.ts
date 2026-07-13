import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../store/useGameStore';

interface WebRTCProps {
  roomId: string;
  isVictim: boolean;
  onRemoteStream: (stream: MediaStream, viewerId: string) => void;
}

export function useWebRTC({ roomId, isVictim, onRemoteStream }: WebRTCProps) {
  const { currentPlayer } = useGameStore();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // Keep track of peer connections (viewerId -> RTCPeerConnection)
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueues = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    if (!roomId || !currentPlayer) return;

    // Create a dedicated broadcast channel for signaling
    const channel = supabase.channel(`webrtc:${roomId}`, {
      config: { broadcast: { self: false } }
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const { type, senderId, targetId, data } = payload;
      
      // Ignore if not intended for me
      if (targetId && targetId !== currentPlayer.id) return;

      if (isVictim) {
        // VICTIM LOGIC
        if (type === 'viewer-join') {
          // A spectator wants to watch. Create a PeerConnection for them ONLY if we have a stream.
          const currentStream = localStreamRef.current;
          if (!currentStream) return;

          const pc = new RTCPeerConnection(ICE_SERVERS);
          peerConnections.current.set(senderId, pc);

          // Add local stream tracks to the connection
          currentStream.getTracks().forEach(track => {
            pc.addTrack(track, currentStream);
          });

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              channel.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'ice-candidate', senderId: currentPlayer.id, targetId: senderId, data: event.candidate }
              });
            }
          };

          // Create offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'offer', senderId: currentPlayer.id, targetId: senderId, data: offer }
          });
        }

        if (type === 'answer') {
          const pc = peerConnections.current.get(senderId);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            const queue = candidateQueues.current.get(senderId) || [];
            for (const c of queue) {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            candidateQueues.current.set(senderId, []);
          }
        }

        if (type === 'ice-candidate') {
          const pc = peerConnections.current.get(senderId);
          if (pc) {
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(data));
            } else {
              const queue = candidateQueues.current.get(senderId) || [];
              queue.push(data);
              candidateQueues.current.set(senderId, queue);
            }
          }
        }

      } else {
        // SPECTATOR LOGIC
        if (type === 'victim-ready') {
          // Victim is ready, now we can ask to join
          channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'viewer-join', senderId: currentPlayer.id }
          });
        }

        if (type === 'offer') {
          const pc = new RTCPeerConnection(ICE_SERVERS);
          peerConnections.current.set(senderId, pc);

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              channel.send({
                type: 'broadcast',
                event: 'signal',
                payload: { type: 'ice-candidate', senderId: currentPlayer.id, targetId: senderId, data: event.candidate }
              });
            }
          };

          pc.ontrack = (event) => {
            onRemoteStream(event.streams[0], senderId);
          };

          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const queue = candidateQueues.current.get(senderId) || [];
          for (const c of queue) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
          }
          candidateQueues.current.set(senderId, []);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: { type: 'answer', senderId: currentPlayer.id, targetId: senderId, data: answer }
          });
        }

        if (type === 'ice-candidate') {
          const pc = peerConnections.current.get(senderId);
          if (pc) {
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(data));
              } catch (e) {
                console.warn('Error adding ICE candidate', e);
              }
            } else {
              const queue = candidateQueues.current.get(senderId) || [];
              queue.push(data);
              candidateQueues.current.set(senderId, queue);
            }
          }
        }
      }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !isVictim) {
        // Send initial join just in case victim is already ready
        channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: { type: 'viewer-join', senderId: currentPlayer.id }
        });
      }
    });

    return () => {
      // Cleanup
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      supabase.removeChannel(channel);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomId, isVictim, currentPlayer?.id]);

  // When the victim's stream becomes available, notify all spectators
  useEffect(() => {
    if (isVictim && localStream && channelRef.current && currentPlayer) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'signal',
        payload: { type: 'victim-ready', senderId: currentPlayer.id }
      });
    }
  }, [isVictim, localStream, currentPlayer?.id]);

  const startCamera = async () => {
    if (!isVictim) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      throw err;
    }
  };

  return { localStream, startCamera };
}
