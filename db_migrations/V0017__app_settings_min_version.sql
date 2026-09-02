-- Общие настройки программы: пара «имя — значение».
-- Первая настройка — минимальная допустимая версия: программы старее
-- неё перестают работать, пока человек не обновится
CREATE TABLE IF NOT EXISTS t_p77779842_pdf_view_edit_conver.app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Пусто = блокировка выключена. Так и оставляем при создании:
-- включать её должен человек осознанно, из панели
INSERT INTO t_p77779842_pdf_view_edit_conver.app_settings (key, value)
VALUES ('min_version', '')
ON CONFLICT (key) DO NOTHING;
