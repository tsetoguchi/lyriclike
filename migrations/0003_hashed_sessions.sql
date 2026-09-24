-- sessions.id becomes the sha256 of the cookie value, so a leaked copy of the
-- table yields no usable session. Old ids mean something else now, which
-- signs everyone out once.
DELETE FROM sessions;
CREATE INDEX sessions_user ON sessions(user_id);
