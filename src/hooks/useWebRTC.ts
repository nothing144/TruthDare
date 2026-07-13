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
  const iceConfigRef = useRef<RTCConfiguration | null>(null);

  const [connectionState, setConnectionState] = useState<'new' | 'connecting' | 'connected' | 'failed'>('new');

  // Fallback STUN-only config (works on same network)
  const FALLBACK_ICE: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  // Fetch TURN credentials securely from Netlify function (API key stays on server)
  useEffect(() => {
    const fetchTurnCredentials = async () => {
      try {
        const res = await fetch('/.netlify/functions/turn-credentials');
        if (!res.ok) throw new Error('Failed to fetch TURN credentials');
        const iceServers = await res.json();
        
        if (Array.isArray(iceServers) && iceServers.length > 0) {
          iceConfigRef.current = {
            iceServers: [
              // Always include STUN as backup
              { urls: 'stun:stun.l.google.com:19302' },
              ...iceServers
            ],
            iceCandidatePoolSize: 10
          };
          console.log('[WebRTC] TURN credentials loaded from Metered');
        } else {
          throw new Error('Invalid TURN response');
        }
      } catch (err) {
        console.warn('[WebRTC] Could not fetch TURN credentials, using STUN fallback:', err);
        iceConfigRef.current = FALLBACK_ICE;
      }
    };

    fetchTurnCredentials();
  }, []);

  const getIceConfig = () => iceConfigRef.current || FALLBACK_ICE;

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
          if (!currentStream) {
            console.log('[WebRTC] Viewer joined but no stream yet, ignoring');
            return;
          }

          // Close existing connection to this viewer if any
          const existingPc = peerConnections.current.get(senderId);
          if (existingPc) {
            existingPc.close();
            peerConnections.current.delete(senderId);
          }

          console.log('[WebRTC] Creating PeerConnection for viewer:', senderId);
          const pc = new RTCPeerConnection(getIceConfig());
          peerConnections.current.set(senderId, pc);

          pc.onconnectionstatechange = () => {
            console.log('[WebRTC] Victim->Viewer connection state:', pc.connectionState);
            setConnectionState(pc.connectionState === 'connected' ? 'connected' :
              pc.connectionState === 'failed' ? 'failed' : 'connecting');
          };

          pc.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
          };

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
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            channel.send({
              type: 'broadcast',
              event: 'signal',
              payload: { type: 'offer', senderId: currentPlayer.id, targetId: senderId, data: offer }
            });
            console.log('[WebRTC] Offer sent to viewer:', senderId);
          } catch (err) {
            console.error('[WebRTC] Error creating offer:', err);
          }
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
          const pc = new RTCPeerConnection(getIceConfig());
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
