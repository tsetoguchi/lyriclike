-- Which client wrote each log row: 'web', 'ios' or 'android'. Without it there
-- is no way to tell how many people use the phone apps. Rows from before this
-- column stay NULL (unknown).
ALTER TABLE logs ADD COLUMN platform TEXT;
