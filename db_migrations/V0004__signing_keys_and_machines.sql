-- Пара ключей для подписи ответов о лицензии.
-- Приватный ключ создаётся на сервере и никогда его не покидает,
-- публичный зашивается в программу для проверки подписи
CREATE TABLE IF NOT EXISTS signing_keys (
    id SERIAL PRIMARY KEY,
    private_pem TEXT NOT NULL,
    public_pem TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Учёт компьютеров, на которых работает ключ: позволяет увидеть
-- превышение оплаченного числа мест
CREATE TABLE IF NOT EXISTS license_machines (
    id SERIAL PRIMARY KEY,
    license_id INTEGER NOT NULL REFERENCES licenses(id),
    machine_id VARCHAR(64) NOT NULL,
    machine_name VARCHAR(255) DEFAULT '',
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (license_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_lic_machines ON license_machines(license_id);