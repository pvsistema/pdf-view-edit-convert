-- Возвращаем пробный заказ в отменённые: показательный ключ был нужен
-- только для проверки внешнего вида страницы «Спасибо за покупку»
UPDATE orders
SET status = 'cancelled',
    paid_at = NULL,
    license_key = '',
    mail_sent = FALSE,
    mail_note = ''
WHERE id = 6
  AND license_key = 'PVPDF-DEMO1-DEMO2-DEMO3-DEMO4';
