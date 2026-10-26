-- /api/me clears expired rows on every page load. Without these, each of
-- those deletes reads its whole table.
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE INDEX logs_created ON logs(created_at);
CREATE INDEX reset_tokens_expires ON reset_tokens(expires_at);
CREATE INDEX pending_signups_expires ON pending_signups(expires_at);
CREATE INDEX rate_limits_window ON rate_limits(window_start);
