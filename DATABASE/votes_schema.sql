CREATE TABLE IF NOT EXISTS votes (
  entry_key TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_key, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_entry_key ON votes(entry_key);
CREATE INDEX IF NOT EXISTS idx_votes_voter_id ON votes(voter_id);
