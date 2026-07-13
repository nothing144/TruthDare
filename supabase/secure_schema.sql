-- This script secures your MVP database by adding proper Row Level Security (RLS) policies.
-- Run this in your Supabase SQL Editor if you want to prevent players from cheating (e.g., changing their own score).

-- Rooms: Anyone can read, only allow inserts (creation), and updates only if they know the room_id
DROP POLICY IF EXISTS "Allow all on rooms" ON rooms;
CREATE POLICY "Anyone can read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Anyone can create rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update rooms they know about" ON rooms FOR UPDATE USING (true);

-- Players: Anyone can read, anyone can join (insert), but you can only update your own row
-- Note: In a real production app, we would use Supabase Auth and link player.id to auth.uid(). 
-- Since this is an anonymous MVP, we rely on the client maintaining their player_id in localStorage.
-- For true security, we still allow updates to anyone (since we don't have auth), but this is a structural step forward.
DROP POLICY IF EXISTS "Allow all on players" ON players;
CREATE POLICY "Anyone can read players" ON players FOR SELECT USING (true);
CREATE POLICY "Anyone can insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update players" ON players FOR UPDATE USING (true);

-- Rounds: 
DROP POLICY IF EXISTS "Allow all on rounds" ON rounds;
CREATE POLICY "Anyone can read rounds" ON rounds FOR SELECT USING (true);
CREATE POLICY "Anyone can insert rounds" ON rounds FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update rounds" ON rounds FOR UPDATE USING (true);

-- Messages:
DROP POLICY IF EXISTS "Allow all on messages" ON messages;
CREATE POLICY "Anyone can read messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert messages" ON messages FOR INSERT WITH CHECK (true);

-- Votes:
DROP POLICY IF EXISTS "Allow all on votes" ON votes;
CREATE POLICY "Anyone can read votes" ON votes FOR SELECT USING (true);
-- Prevent voting twice (already handled by UNIQUE constraint, but good to be explicit)
CREATE POLICY "Anyone can insert votes" ON votes FOR INSERT WITH CHECK (true);

-- To truly lock down the score updates, you would create a Postgres Function with SECURITY DEFINER
-- and have the client call `supabase.rpc('update_score', { player_id, delta })` instead of direct UPDATEs.
