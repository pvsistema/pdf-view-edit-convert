-- Тарифы: цены задаются в панели управления, а не в коде программы
CREATE TABLE IF NOT EXISTS tariffs (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    title VARCHAR(160) NOT NULL,
    note VARCHAR(255) DEFAULT '',
    price NUMERIC(10, 2) NOT NULL,
    months INTEGER NOT NULL DEFAULT 12,
    seats INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Заказы. Ключ создаётся только после подтверждения оплаты банком
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    tariff_id INTEGER REFERENCES tariffs(id),
    -- Копии условий на момент покупки: смена цены не должна
    -- задним числом менять уже оформленный заказ
    price NUMERIC(10, 2) NOT NULL,
    months INTEGER NOT NULL DEFAULT 12,
    seats INTEGER NOT NULL DEFAULT 1,
    title VARCHAR(160) DEFAULT '',
    email VARCHAR(255) DEFAULT '',
    org_name VARCHAR(255) DEFAULT '',
    -- Тайное слово заказа: по нему программа спрашивает о своей покупке,
    -- не раскрывая чужие заказы подбором номера
    token VARCHAR(64) UNIQUE NOT NULL,
    machine_id VARCHAR(64) DEFAULT '',
    -- new -> paid (деньги пришли) | failed | cancelled
    status VARCHAR(20) NOT NULL DEFAULT 'new',
    license_id INTEGER REFERENCES licenses(id),
    license_key VARCHAR(64) DEFAULT '',
    -- Продление: если платили по уже существующему ключу
    renew_key VARCHAR(64) DEFAULT '',
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(token);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

-- Начальные тарифы: цены можно менять в панели управления
INSERT INTO tariffs (code, title, note, price, months, seats, sort) VALUES
    ('year1', 'Лицензия на 1 год', 'Одно рабочее место', 2900, 12, 1, 10),
    ('year1_x5', 'Лицензия на 1 год, 5 мест', 'Для небольшого отдела', 11900, 12, 5, 20),
    ('year3', 'Лицензия на 3 года', 'Выгоднее продления каждый год', 6900, 36, 1, 30)
ON CONFLICT (code) DO NOTHING;
