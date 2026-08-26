-- Машина, использованная при проверке защиты модуля, место не занимает
UPDATE license_machines
SET last_seen = NOW() - INTERVAL '400 days'
WHERE machine_id = 'buildmachine0001';