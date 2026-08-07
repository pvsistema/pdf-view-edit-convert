CREATE TABLE IF NOT EXISTS app_releases (
    id SERIAL PRIMARY KEY,
    version VARCHAR(20) UNIQUE NOT NULL,
    download_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_required BOOLEAN DEFAULT FALSE,
    is_published BOOLEAN DEFAULT TRUE,
    published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_releases_pub ON app_releases(is_published, published_at DESC);
