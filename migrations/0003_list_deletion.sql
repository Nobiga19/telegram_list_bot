ALTER TABLE lists ADD COLUMN deleted_at TEXT;
CREATE INDEX lists_group_visible_created ON lists(group_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
