-- Помечаем один пробный заказ оплаченным, чтобы проверить вид страницы
-- «Спасибо за покупку» с выданным ключом. Настоящая лицензия при этом
-- не создаётся: ключ показательный, в таблице licenses его нет
UPDATE orders
SET status = 'paid',
    paid_at = NOW(),
    license_key = 'PVPDF-DEMO1-DEMO2-DEMO3-DEMO4',
    mail_sent = TRUE,
    mail_note = 'Проверка внешнего вида страницы'
WHERE id = 6;
