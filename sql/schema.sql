CREATE TABLE IF NOT EXISTS games (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
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
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    played BOOLEAN DEFAULT false,
    excluded BOOLEAN DEFAULT false,
    registered BOOLEAN DEFAULT false,
    registered_at TIMESTAMPTZ,
    UNIQUE(chat_id, external_id)
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
    processed_for_registration BOOLEAN DEFAULT false,
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

CREATE INDEX IF NOT EXISTS idx_games_chat_datetime ON games(chat_id, date_time);
CREATE INDEX IF NOT EXISTS idx_games_chat_group ON games(chat_id, group_key);
CREATE INDEX IF NOT EXISTS idx_games_flags ON games(played, excluded);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_settings (
    chat_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(chat_id, key)
);

CREATE TABLE IF NOT EXISTS chat_played_groups (
    chat_id TEXT NOT NULL,
    group_key TEXT NOT NULL,
    played_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(chat_id, group_key)
);

CREATE TABLE IF NOT EXISTS chat_excluded_types (
    chat_id TEXT NOT NULL,
    type_name TEXT NOT NULL,
    excluded_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(chat_id, type_name)
);

CREATE TABLE IF NOT EXISTS team_info (
    chat_id TEXT PRIMARY KEY,
    team_name TEXT NOT NULL,
    captain_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);