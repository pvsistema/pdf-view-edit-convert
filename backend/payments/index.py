import hashlib
import json
import os
import random
import string
from datetime import datetime, timedelta
from urllib.parse import quote

import psycopg2

import mailer

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx'
TEST_PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx'


def _esc(v) -> str:
    return str(v).replace("'", "''")


def _resp(code: int, body: dict) -> dict:
    return {
        'statusCode': code,
        'headers': CORS,
        'isBase64Encoded': False,
        'body': json.dumps(body, ensure_ascii=False, default=str),
    }


def _text(code: int, body: str) -> dict:
    '''Робокасса ждёт простой текст, а не JSON'''
    head = dict(CORS)
    head['Content-Type'] = 'text/plain; charset=utf-8'
    return {'statusCode': code, 'headers': head, 'isBase64Encoded': False, 'body': body}


def _gen_key() -> str:
    groups = [''.join(random.choice(ALPHABET) for _ in range(5)) for _ in range(4)]
    return 'PVPDF-' + '-'.join(groups)


def _gen_token() -> str:
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(40))


def _auth(cur, event, body) -> bool:
    headers = event.get('headers') or {}
    token = headers.get('X-Auth-Token') or headers.get('x-auth-token') or body.get('token', '')
    if not token:
        return False
    cur.execute(
        f"SELECT 1 FROM {SCHEMA}.admin_sessions "
        f"WHERE token = '{_esc(token)}' AND expires_at > NOW()"
    )
    return cur.fetchone() is not None


def _money(v) -> str:
    '''Сумма в том виде, в каком её подписывает Робокасса: 2900.00'''
    return f'{float(v):.2f}'


def _md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def _shop():
    return (
        os.environ.get('ROBOKASSA_LOGIN', ''),
        os.environ.get('ROBOKASSA_PASSWORD1', ''),
        os.environ.get('ROBOKASSA_PASSWORD2', ''),
        os.environ.get('ROBOKASSA_TEST', '') == '1',
    )


def _tariff_row(r) -> dict:
    return {
        'id': r[0],
        'code': r[1],
        'title': r[2],
        'note': r[3] or '',
        'price': float(r[4]),
        'months': r[5],
        'seats': r[6],
        'sort': r[7],
        'is_active': bool(r[8]),
    }


TARIFF_FIELDS = 'id, code, title, note, price, months, seats, sort, is_active'


def _receipt(title: str, price) -> str:
    '''Состав чека по 54-ФЗ. Без него Робокасса не проведёт платёж
    у продавцов, обязанных выбивать чеки'''
    item = {
        'name': title[:128],
        'quantity': 1,
        'sum': float(_money(price)),
        'payment_method': 'full_payment',
        'payment_object': 'service',
        'tax': os.environ.get('ROBOKASSA_TAX', 'none'),
    }
    return json.dumps({'items': [item]}, ensure_ascii=False)


def _add_months(day, months: int):
    '''Прибавление месяцев по календарю. Считать месяц за 30 дней нельзя:
    на годовой лицензии набегала недостача в пять дней, и клиент получал
    меньше оплаченного'''
    total = day.month - 1 + months
    year = day.year + total // 12
    month = total % 12 + 1

    # 31 января плюс месяц — это 28 (или 29) февраля, а не 3 марта
    if month == 12:
        last = 31
    else:
        nxt = datetime(year + (1 if month == 12 else 0), month % 12 + 1, 1).date()
        last = (nxt - timedelta(days=1)).day
    return day.replace(year=year, month=month, day=min(day.day, last))


def _mail_key(cur, order_id: int, key: str, title: str, until: str,
              seats: int, email: str, renew: bool = False, manual: bool = False) -> None:
    '''Письмо с ключом покупателю. Ошибка отправки НЕ должна ронять оплату:
    деньги уже получены и ключ уже выдан — иначе банк, не увидев ответа,
    прислал бы уведомление снова. Что не отправилось, видно в панели'''
    if not email or '@' not in email:
        return

    try:
        subject = 'Продление лицензии — ПВ-Система PDF' if renew else 'Ваш ключ активации — ПВ-Система PDF'
        text, html = mailer.key_letter(key, title or 'Лицензия', until, int(seats or 1))
        # При оплате ждём почту недолго, при отправке из панели — дольше:
        # там никто не ждёт ответа банка, и медленная почта не помешает
        ok, note = mailer.send(email, subject, text, html, wait=20 if manual else 0)
    except Exception as e:
        ok, note = False, f'Сбой отправки: {e}'

    try:
        cur.execute(
            f"UPDATE {SCHEMA}.orders SET mail_sent = {'TRUE' if ok else 'FALSE'}, "
            f"mail_note = '{_esc(note)[:250]}', mail_at = NOW() WHERE id = {order_id}"
        )
    except Exception:
        # Даже запись об отправке не должна мешать выдаче ключа
        pass


def _grant_license(cur, order_id: int) -> None:
    '''Выдача ключа после оплаты. Повторный вызов ничего не меняет:
    банк присылает уведомление не один раз, и второй ключ выдавать нельзя'''
    cur.execute(
        f"SELECT status, months, seats, email, org_name, title, renew_key, license_id "
        f"FROM {SCHEMA}.orders WHERE id = {order_id}"
    )
    row = cur.fetchone()
    if not row:
        return
    status, months, seats, email, org, title, renew_key, license_id = row

    # Ключ уже выдан — уведомление повторное
    if status == 'paid' and license_id:
        return

    months = int(months or 12)
    seats = max(1, int(seats or 1))

    if renew_key:
        # Продление: срок прибавляется к текущему, если он ещё не вышел
        cur.execute(
            f"SELECT id, valid_until FROM {SCHEMA}.licenses "
            f"WHERE license_key = '{_esc(renew_key)}'"
        )
        found = cur.fetchone()
        if found:
            lic_id, until = found
            base = until if until and until > datetime.utcnow().date() else datetime.utcnow().date()
            new_until = _add_months(base, months)
            cur.execute(
                f"UPDATE {SCHEMA}.licenses SET valid_until = '{new_until}', "
                f"status = 'active', updated_at = NOW() WHERE id = {lic_id}"
            )
            cur.execute(
                f"UPDATE {SCHEMA}.orders SET status = 'paid', paid_at = NOW(), "
                f"license_id = {lic_id}, license_key = '{_esc(renew_key)}' WHERE id = {order_id}"
            )
            _mail_key(cur, order_id, renew_key, title, str(new_until), seats, email, renew=True)
            return

    # Новая лицензия
    until = _add_months(datetime.utcnow().date(), months)
    name = (org or '').strip() or (email or '').strip() or 'Покупка через сайт'

    for _ in range(6):
        key = _gen_key()
        cur.execute(f"SELECT 1 FROM {SCHEMA}.licenses WHERE license_key = '{key}'")
        if not cur.fetchone():
            break

    cur.execute(
        f"INSERT INTO {SCHEMA}.licenses (org_name, license_key, valid_until, seats, contact, note, status) "
        f"VALUES ('{_esc(name)}', '{key}', '{until}', {seats}, '{_esc(email)}', "
        f"'Оплачено через сайт: {_esc(title)}', 'active') RETURNING id"
    )
    lic_id = cur.fetchone()[0]

    cur.execute(
        f"UPDATE {SCHEMA}.orders SET status = 'paid', paid_at = NOW(), "
        f"license_id = {lic_id}, license_key = '{key}' WHERE id = {order_id}"
    )
    _mail_key(cur, order_id, key, title, str(until), seats, email)


def handler(event, context):
    '''Оплата лицензии: тарифы, оформление заказа, приём подтверждения от банка и выдача ключа'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except (ValueError, TypeError):
            body = {}
    params = event.get('queryStringParameters') or {}
    action = body.get('action') or params.get('action', '')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    try:
        # --- Список тарифов для окна покупки ---
        if action == 'tariffs':
            cur.execute(
                f"SELECT {TARIFF_FIELDS} FROM {SCHEMA}.tariffs "
                f"WHERE is_active = TRUE ORDER BY sort, id"
            )
            items = [_tariff_row(r) for r in cur.fetchall()]
            login, pass1, _, _ = _shop()
            return _resp(200, {'items': items, 'ready': bool(login and pass1)})

        # --- Оформление заказа: ссылка на оплату ---
        if action == 'create_order':
            login, pass1, _, test = _shop()
            if not login or not pass1:
                return _resp(200, {'error': 'Приём оплаты пока не настроен'})

            code = _esc(str(body.get('tariff', '')).strip())
            cur.execute(
                f"SELECT {TARIFF_FIELDS} FROM {SCHEMA}.tariffs "
                f"WHERE code = '{code}' AND is_active = TRUE"
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Тариф не найден'})
            t = _tariff_row(row)

            email = _esc(str(body.get('email', '')).strip())[:240]
            org = _esc(str(body.get('org_name', '')).strip())[:240]
            machine = _esc(str(body.get('machine_id', '')).strip())[:60]
            renew = _esc(str(body.get('renew_key', '')).strip().upper())[:60]
            token = _gen_token()

            cur.execute(
                f"INSERT INTO {SCHEMA}.orders "
                f"(tariff_id, price, months, seats, title, email, org_name, token, machine_id, renew_key) "
                f"VALUES ({t['id']}, {t['price']}, {t['months']}, {t['seats']}, "
                f"'{_esc(t['title'])}', '{email}', '{org}', '{token}', '{machine}', '{renew}') "
                f"RETURNING id"
            )
            order_id = cur.fetchone()[0]

            total = _money(t['price'])
            desc = t['title'][:100]
            receipt = _receipt(t['title'], t['price'])

            # Подпись заказа. Чек в ней участвует закодированным один раз:
            # MerchantLogin:OutSum:InvId:Receipt:Пароль#1
            #
            # Своя метка заказа (Shp_tok) ОБЯЗАНА входить в подпись и идти
            # после пароля — иначе банк отвергнет платёж. Такие метки
            # добавляются в конец по алфавиту, в виде «имя=значение»
            enc_receipt = quote(receipt, safe='')
            sign = _md5(f"{login}:{total}:{order_id}:{enc_receipt}:{pass1}:Shp_tok={token}")

            # А в самой ссылке чек кодируется ЕЩЁ раз: иначе его знаки
            # разорвут адрес и банк отвергнет подпись. Требование
            # Робокассы именно для ссылок, открываемых в браузере
            url_receipt = quote(enc_receipt, safe='')

            url = (
                f"{TEST_PAY_URL if test else PAY_URL}"
                f"?MerchantLogin={quote(login)}"
                f"&OutSum={total}"
                f"&InvId={order_id}"
                f"&Description={quote(desc)}"
                f"&Receipt={url_receipt}"
                f"&SignatureValue={sign}"
                f"&Email={quote(str(body.get('email', '')).strip())}"
                f"&Culture=ru"
                # Банк вернёт это значение на страницу «Спасибо»,
                # и она сможет показать именно этот заказ
                f"&Shp_tok={quote(token)}"
            )
            if test:
                url += '&IsTest=1'

            return _resp(200, {
                'order_id': order_id,
                'token': token,
                'pay_url': url,
                'price': t['price'],
                'title': t['title'],
            })

        # --- Уведомление от банка: деньги поступили ---
        if action == 'result':
            _, _, pass2, _ = _shop()
            # Уведомление приходит и в теле запроса, и в адресе — собираем
            # оба источника, иначе метки заказа могут потеряться
            src = dict(params or {})
            src.update(body or {})
            out = str(src.get('OutSum') or src.get('outSum') or '')
            inv = str(src.get('InvId') or src.get('invId') or '')
            got = str(src.get('SignatureValue') or src.get('signatureValue') or '').lower()

            if not inv.isdigit():
                return _text(400, 'bad invoice')

            # Свои метки заказа банк возвращает вместе с уведомлением, и они
            # тоже входят в подпись: по алфавиту, в конце, как «имя=значение».
            # Без них подпись не сойдётся и оплата не будет засчитана
            extra = ''.join(
                f':{name}={src[name]}'
                for name in sorted(k for k in src if str(k).lower().startswith('shp_'))
            )

            mine = _md5(f"{out}:{inv}:{pass2}{extra}").lower()
            if not pass2 or got != mine:
                return _text(400, 'bad sign')

            order_id = int(inv)
            cur.execute(
                f"SELECT price, status FROM {SCHEMA}.orders WHERE id = {order_id}"
            )
            row = cur.fetchone()
            if not row:
                return _text(404, 'no order')

            # Сумма должна совпасть с заказом: иначе оплату могли подменить
            if _money(row[0]) != _money(out or 0):
                return _text(400, 'bad sum')

            _grant_license(cur, order_id)
            return _text(200, f'OK{order_id}')

        # --- Программа спрашивает о своём заказе ---
        if action == 'order_status':
            token = _esc(str(body.get('token') or params.get('token', '')).strip())
            if not token:
                return _resp(400, {'error': 'Заказ не указан'})
            cur.execute(
                f"SELECT status, license_key, title, price FROM {SCHEMA}.orders "
                f"WHERE token = '{token}'"
            )
            row = cur.fetchone()
            if not row:
                return _resp(404, {'error': 'Заказ не найден'})
            status, key, title, price = row
            return _resp(200, {
                'status': status,
                'paid': status == 'paid',
                'license_key': key or '',
                'title': title or '',
                'price': float(price or 0),
            })

        # Настроена ли отправка писем — знать полезно и до входа
        if action == 'mail_ready':
            return _resp(200, {'ready': mailer.ready()})

        # --- Панель управления ---
        if not _auth(cur, event, body):
            return _resp(401, {'error': 'Нужен вход в панель'})

        # Разбор настроек оплаты: показывает, что именно уходит в банк,
        # но никогда не раскрывает пароли — только их признаки
        if action == 'pay_check':
            login, pass1, pass2, test = _shop()
            probe = _md5(f"{login}:100.00:1:{pass1}")
            return _resp(200, {
                'login': login,
                'login_looks_like_password': not login.replace('-', '').replace('_', '').isalnum(),
                'pass1_set': bool(pass1),
                'pass1_len': len(pass1),
                'pass2_set': bool(pass2),
                'pass2_len': len(pass2),
                'test_mode': test,
                'tax': os.environ.get('ROBOKASSA_TAX', 'none'),
                # Простая ссылка без чека и меток: если банк примет её,
                # значит пароль верный, а дело в чеке или метках
                'simple_url': (
                    f"{PAY_URL}?MerchantLogin={quote(login)}&OutSum=100.00&InvId=1"
                    f"&Description={quote('Проверка')}&SignatureValue={probe}"
                ),
            })

        # Пробное письмо. Уходит ТОЛЬКО на собственный ящик магазина:
        # так проверка доступна без входа, но разослать письма кому
        # угодно через неё нельзя
        if action == 'test_mail':
            own = os.environ.get('SMTP_USER', '').strip()
            if not own:
                return _resp(200, {'ok': False, 'note': 'Отправка почты не настроена'})

            text, html = mailer.key_letter(
                'PVPDF-XXXXX-XXXXX-XXXXX-XXXXX', 'Проверка отправки', '2027-09-01', 1
            )
            ok, note = mailer.send(own, 'Проверка отправки — ПВ-Система PDF', text, html, wait=20)
            return _resp(200, {'ok': ok, 'note': note, 'to': own})

        if action == 'admin_tariffs':
            cur.execute(f"SELECT {TARIFF_FIELDS} FROM {SCHEMA}.tariffs ORDER BY sort, id")
            return _resp(200, {'items': [_tariff_row(r) for r in cur.fetchall()]})

        if action == 'save_tariff':
            tid = int(body.get('id') or 0)
            title = _esc(str(body.get('title', '')).strip())[:160]
            note = _esc(str(body.get('note', '')).strip())[:250]
            price = float(body.get('price') or 0)
            months = max(1, int(body.get('months') or 12))
            seats = max(1, int(body.get('seats') or 1))
            sort = int(body.get('sort') or 0)
            active = 'TRUE' if body.get('is_active', True) else 'FALSE'

            if not title or price <= 0:
                return _resp(400, {'error': 'Укажите название и цену'})

            if tid:
                cur.execute(
                    f"UPDATE {SCHEMA}.tariffs SET title = '{title}', note = '{note}', "
                    f"price = {price}, months = {months}, seats = {seats}, sort = {sort}, "
                    f"is_active = {active}, updated_at = NOW() WHERE id = {tid} "
                    f"RETURNING {TARIFF_FIELDS}"
                )
            else:
                code = _esc(str(body.get('code', '')).strip()) or f'tariff{int(datetime.utcnow().timestamp())}'
                cur.execute(
                    f"INSERT INTO {SCHEMA}.tariffs (code, title, note, price, months, seats, sort, is_active) "
                    f"VALUES ('{code}', '{title}', '{note}', {price}, {months}, {seats}, {sort}, {active}) "
                    f"RETURNING {TARIFF_FIELDS}"
                )
            row = cur.fetchone()
            return _resp(200, {'item': _tariff_row(row)})

        if action == 'delete_tariff':
            tid = int(body.get('id') or 0)
            cur.execute(f"UPDATE {SCHEMA}.tariffs SET is_active = FALSE WHERE id = {tid}")
            return _resp(200, {'ok': True})

        if action == 'orders':
            limit = min(500, max(1, int(body.get('limit') or 100)))
            cur.execute(
                f"SELECT id, title, price, status, email, org_name, license_key, "
                f"created_at, paid_at, mail_sent, mail_note "
                f"FROM {SCHEMA}.orders ORDER BY id DESC LIMIT {limit}"
            )
            items = [
                {
                    'id': r[0],
                    'title': r[1] or '',
                    'price': float(r[2] or 0),
                    'status': r[3],
                    'email': r[4] or '',
                    'org_name': r[5] or '',
                    'license_key': r[6] or '',
                    'created_at': r[7].strftime('%Y-%m-%d %H:%M') if r[7] else '',
                    'paid_at': r[8].strftime('%Y-%m-%d %H:%M') if r[8] else '',
                    'mail_sent': bool(r[9]),
                    'mail_note': r[10] or '',
                }
                for r in cur.fetchall()
            ]
            cur.execute(
                f"SELECT COUNT(*), COALESCE(SUM(price), 0) FROM {SCHEMA}.orders WHERE status = 'paid'"
            )
            paid_count, paid_sum = cur.fetchone()
            return _resp(200, {
                'items': items,
                'stats': {'paid': int(paid_count), 'total_sum': float(paid_sum)},
            })

        # Отправить письмо заново: адрес был с опечаткой или почта молчала
        if action == 'resend_mail':
            order_id = int(body.get('id') or 0)
            to = str(body.get('email', '')).strip()

            cur.execute(
                f"SELECT license_key, title, seats, email, license_id "
                f"FROM {SCHEMA}.orders WHERE id = {order_id}"
            )
            row = cur.fetchone()
            if not row or not row[0]:
                return _resp(400, {'error': 'По этому заказу ключ ещё не выдан'})
            key, title, seats, saved_mail, lic_id = row

            # Новый адрес запоминаем: старый мог быть с ошибкой
            if to and '@' in to and to != saved_mail:
                cur.execute(
                    f"UPDATE {SCHEMA}.orders SET email = '{_esc(to)}' WHERE id = {order_id}"
                )
            else:
                to = saved_mail

            cur.execute(f"SELECT valid_until FROM {SCHEMA}.licenses WHERE id = {lic_id or 0}")
            found = cur.fetchone()
            until = str(found[0]) if found else ''

            _mail_key(cur, order_id, key, title, until, int(seats or 1), to, manual=True)

            cur.execute(f"SELECT mail_sent, mail_note FROM {SCHEMA}.orders WHERE id = {order_id}")
            sent, note = cur.fetchone()
            return _resp(200, {'ok': bool(sent), 'note': note or ''})

        # Выдача ключа вручную: деньги пришли мимо банка (счёт, перевод)
        if action == 'mark_paid':
            order_id = int(body.get('id') or 0)
            _grant_license(cur, order_id)
            cur.execute(f"SELECT license_key FROM {SCHEMA}.orders WHERE id = {order_id}")
            row = cur.fetchone()
            return _resp(200, {'ok': True, 'license_key': row[0] if row else ''})

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        cur.close()
        conn.close()