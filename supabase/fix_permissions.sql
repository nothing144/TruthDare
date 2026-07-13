-- Grant table permissions to anon role
GRANT ALL ON rooms TO anon, authenticated;
GRANT ALL ON players TO anon, authenticated;
GRANT ALL ON rounds TO anon, authenticated;
GRANT ALL ON messages TO anon, authenticated;
GRANT ALL ON votes TO anon, authenticated;

-- Allow all operations for MVP (RLS Policies)
-- Drops existing if they were created
DROP POLICY IF EXISTS "Allow all on rooms" ON rooms;
DROP POLICY IF EXISTS "Allow all on players" ON players;
DROP POLICY IF EXISTS "Allow all on rounds" ON rounds;
DROP POLICY IF EXISTS "Allow all on messages" ON messages;
DROP POLICY IF EXISTS "Allow all on votes" ON votes;

CREATE POLICY "Allow all on rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on players" ON players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on rounds" ON rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on messages" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on votes" ON votes FOR ALL USING (true) WITH CHECK (true);
