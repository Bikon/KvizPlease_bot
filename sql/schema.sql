CREATE TABLE IF NOT EXISTS games (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    date_time TIMESTAMP WITH TIME ZONE NOT NULL,
    venue TEXT,
    district TEXT,
    address TEXT,
    price TEXT,
    difficulty TEXT,
    status TEXT,
    url TEXT NOT NULL,
    group_key TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    played BOOLEAN DEFAULT false,
    excluded BOOLEAN DEFAULT false
    );

CREATE TABLE IF NOT EXISTS processed_groups (
    group_key TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS polls (
    id BIGSERIAL PRIMARY KEY,
    poll_id TEXT UNIQUE NOT NULL,
    chat_id TEXT NOT NULL,
    message_id BIGINT NOT NULL,
    group_key TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
    id BIGSERIAL PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(poll_id) ON DELETE CASCADE,
    option_id INT NOT NULL,
    game_external_id TEXT,
    is_unavailable BOOLEAN DEFAULT false
    );

CREATE TABLE IF NOT EXISTS poll_votes (
    id BIGSERIAL PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(poll_id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    option_ids INT[] NOT NULL,
    voted_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(poll_id, user_id)
    );

CREATE TABLE IF NOT EXISTS excluded_groups (
   group_key TEXT PRIMARY KEY,
   excluded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS excluded_types (
  type_name TEXT PRIMARY KEY,
  excluded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_datetime ON games(date_time);
CREATE INDEX IF NOT EXISTS idx_games_group    ON games(group_key);
CREATE INDEX IF NOT EXISTS idx_games_flags    ON games(played, excluded);
