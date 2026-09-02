-- Пробный режим: отметки о бесплатных запусках платных инструментов.
-- Нужны, чтобы видеть, сколько человек упёрлось в лимит и сколько из них
-- потом купило ключ. Счёт ведёт сама программа, сюда шлёт отметку

CREATE TABLE IF NOT EXISTS t_p77779842_pdf_view_edit_conver.trial_events (
    id SERIAL PRIMARY KEY,
    -- Отпечаток компьютера: по нему же считаются места лицензий,
    -- поэтому покупку удастся связать с пробой
    machine_id VARCHAR(60) NOT NULL,
    machine_name VARCHAR(160) DEFAULT '',
    -- used — потрачена попытка, limit — попытки закончились
    event VARCHAR(20) NOT NULL DEFAULT 'used',
    tool VARCHAR(40) DEFAULT '',
    used_count INTEGER DEFAULT 0,
    app_version VARCHAR(20) DEFAULT '',
    ip VARCHAR(60) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trial_events_machine_idx
    ON t_p77779842_pdf_view_edit_conver.trial_events (machine_id);

CREATE INDEX IF NOT EXISTS trial_events_event_idx
    ON t_p77779842_pdf_view_edit_conver.trial_events (event, created_at);
