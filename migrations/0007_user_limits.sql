-- Per-account limits on pages and people per page. NULL uses the site
-- default (DEFAULT_PAGE_LIMIT / DEFAULT_PEOPLE_LIMIT); -1 means no limit.
CREATE TABLE user_limits (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  page_limit INTEGER CHECK (page_limit IS NULL OR page_limit >= -1),
  people_limit INTEGER CHECK (people_limit IS NULL OR people_limit >= -1)
);
