package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS sessions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name  TEXT    NOT NULL,
    exe_path  TEXT    NOT NULL,
    category  TEXT    NOT NULL,
    date      TEXT    NOT NULL,
    duration  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(app_name, date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
CREATE TABLE IF NOT EXISTS categories (
    exe_name TEXT PRIMARY KEY,
    category TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timeline (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name  TEXT    NOT NULL,
    category  TEXT    NOT NULL,
    hour      INTEGER NOT NULL,
    date      TEXT    NOT NULL,
    duration  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_app_hour_date
    ON timeline(app_name, hour, date);
`

// Open opens (and initializes) the Vigil database at os.UserCacheDir()/vigil/data.db.
func Open() (*sql.DB, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return nil, fmt.Errorf("user cache dir: %w", err)
	}
	dir := filepath.Join(cacheDir, "vigil")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", dir, err)
	}
	path := filepath.Join(dir, "data.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}
	return db, nil
}
