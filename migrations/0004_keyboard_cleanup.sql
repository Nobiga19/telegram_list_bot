-- Retire legacy reply keyboards once per group without recurring cleanup messages.
ALTER TABLE groups ADD COLUMN keyboard_cleanup_message_id INTEGER;
ALTER TABLE groups ADD COLUMN keyboard_cleanup_started_at INTEGER;
