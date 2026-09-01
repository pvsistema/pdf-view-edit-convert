-- Пробные заказы от проверки оплаты и почты помечаем отменёнными,
-- чтобы они не мешали в списке. Оплаченные заказы и заказы с выданным
-- ключом не трогаем
UPDATE orders
SET status = 'cancelled'
WHERE status = 'new'
  AND (license_key IS NULL OR license_key = '')
  AND license_id IS NULL;
