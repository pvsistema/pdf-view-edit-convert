-- Временный пароль администратора панели лицензий.
-- Хранится необратимым отпечатком, как и все пароли.
-- Логин PVSPDF, пароль меняется в самой панели после входа.
UPDATE admins
SET pass_hash = '8182a4a7c9fd8ffdcd1a3f916b946e22de1001b8df721639673094345b3ae2ea'
WHERE login = 'PVSPDF';

-- Прежние входы прекращаем: пароль сменился
UPDATE admin_sessions SET expires_at = NOW()
WHERE admin_id IN (SELECT id FROM admins WHERE login = 'PVSPDF');