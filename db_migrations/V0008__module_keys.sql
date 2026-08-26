-- Ключ расшифровки платного модуля. Сам модуль хранится зашифрованным
-- и без этого ключа не запускается: в программе его нет, сервер выдаёт
-- ключ только по действующей лицензии
CREATE TABLE IF NOT EXISTS module_keys (
    id SERIAL PRIMARY KEY,
    module VARCHAR(40) NOT NULL,
    secret VARCHAR(128) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_module_keys ON module_keys(module, is_active);