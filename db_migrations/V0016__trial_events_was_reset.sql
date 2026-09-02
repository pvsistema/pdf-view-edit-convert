-- Признак обнуления счётчика: программа прислала номер пробы меньше,
-- чем сервер уже насчитал за этим компьютером. Значит счёт в программе
-- сбросили — вручную или переустановкой с чисткой
ALTER TABLE t_p77779842_pdf_view_edit_conver.trial_events
    ADD COLUMN IF NOT EXISTS was_reset BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS trial_events_reset_idx
    ON t_p77779842_pdf_view_edit_conver.trial_events (was_reset)
    WHERE was_reset = TRUE;
