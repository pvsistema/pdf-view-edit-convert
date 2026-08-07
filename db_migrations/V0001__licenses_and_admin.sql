CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    login VARCHAR(80) UNIQUE NOT NULL,
    pass_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token VARCHAR(80) PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    org_name VARCHAR(255) NOT NULL,
    license_key VARCHAR(64) UNIQUE NOT NULL,
    valid_until DATE NOT NULL,
    seats INTEGER DEFAULT 1,
    contact VARCHAR(255) DEFAULT '',
    note TEXT DEFAULT '',
    status VARCHAR(20) DEFAULT 'active',
    activations INTEGER DEFAULT 0,
    last_check_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_org ON licenses(org_name);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON admin_sessions(expires_at);
