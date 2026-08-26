-- Последняя проверочная запись тоже освобождает место
UPDATE license_machines
SET last_seen = NOW() - INTERVAL '400 days'
WHERE machine_id = 'realpc00000000aa';