-- Telegram may choose a random update_id after a week without updates.
-- Order membership changes by Telegram's signed event date before comparing IDs.
ALTER TABLE groups ADD COLUMN last_event_date INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN last_announced_event_date INTEGER NOT NULL DEFAULT 0;
