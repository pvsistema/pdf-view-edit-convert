-- Отметка об отправке письма с ключом. Нужна, чтобы в панели было видно,
-- дошло ли письмо до покупателя, и можно было отправить повторно
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mail_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mail_note VARCHAR(255) DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mail_at TIMESTAMP;
