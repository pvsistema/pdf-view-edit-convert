CREATE TABLE IF NOT EXISTS license_checks (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id),
    license_key VARCHAR(64) NOT NULL,
    result VARCHAR(30) NOT NULL,
    ip VARCHAR(64) DEFAULT '',
    user_agent VARCHAR(255) DEFAULT '',
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_checks_lic ON license_checks(license_id);
CREATE INDEX IF NOT EXISTS idx_checks_time ON license_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_key ON license_checks(license_key);
