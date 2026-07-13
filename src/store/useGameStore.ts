import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player, Room } from '../types';

interface GameState {
  currentPlayer: Player | null;
  room: Room | null;
  players: Player[];
  serverTimeOffset: number;
  setCurrentPlayer: (player: Player | null) => void;
  setRoom: (room: Room | null) => void;
  setPlayers: (players: Player[]) => void;
  setServerTimeOffset: (offset: number) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      currentPlayer: null,
      room: null,
      players: [],
      serverTimeOffset: 0,
      setCurrentPlayer: (player) => set({ currentPlayer: player }),
      setRoom: (room) => set({ room }),
      setPlayers: (players) => set({ players }),
      setServerTimeOffset: (offset) => set({ serverTimeOffset: offset }),
    }),
    {
      name: 'truth-or-dare-storage',
      partialize: (state) => ({ currentPlayer: state.currentPlayer, room: state.room }),
    }
  )
);
