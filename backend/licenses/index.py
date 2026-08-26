import json
import os
import random
import string
from datetime import datetime, timedelta

import psycopg2

from signing import ensure_keys, public_key_raw, sign_payload


CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def _esc(v) -> str:
    return str(v).replace("'", "''")


def _resp(code: int, body: dict) -> dict:
    return {'statusCode': code, 'headers': CORS, 'isBase64Encoded': False, 'body': json.dumps(body, ensure_ascii=False, default=str)}


def _gen_key() -> str:
    groups = [''.join(random.choice(ALPHABET) for _ in range(5)) for _ in range(4)]
    return 'PVPDF-' + '-'.join(groups)


def _auth(cur, event, body) -> bool:
    headers = event.get('headers') or {}
    token = headers.get('X-Auth-Token') or headers.get('x-auth-token') or body.get('token', '')
    if not token:
        return False
    cur.execute(
        f"SELECT 1 FROM {SCHEMA}.admin_sessions WHERE token = '{_esc(token)}' AND expires_at > NOW()"
    )
    return cur.fetchone() is not None


def _ver_num(v: str):
    parts = (v or '0.0.0').split('.')
    out = []
    for p in parts[:3]:
        try:
            out.append(int(p))
        except ValueError:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    return tuple(out)


def _latest_release(cur, current: str) -> dict:
    '''Сведения о новой версии программы — отдаются вместе с проверкой ключа'''
    cur.execute(
        f"SELECT version, download_url, notes, is_required, published_at "
        f"FROM {SCHEMA}.app_releases WHERE is_published = TRUE "
        f"ORDER BY published_at DESC LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return {'update_available': False, 'latest': current}
    version, url, notes, required, published = row
    newer = _ver_num(version) > _ver_num(current)
    return {
        'update_available': newer,
        'latest': version,
        'download_url': url or '',
        'notes': notes or '',
        'required': bool(required) and newer,
        'published_at': published.strftime('%Y-%m-%d') if published else '',
    }


def _row(r) -> dict:
    return {
        'id': r[0],
        'org_name': r[1],
        'license_key': r[2],
        'valid_until': r[3].strftime('%Y-%m-%d') if r[3] else '',
        'seats': r[4],
        'contact': r[5] or '',
        'note': r[6] or '',
        'status': r[7],
        'activations': r[8],
        'created_at': r[9].strftime('%Y-%m-%d %H:%M') if r[9] else '',
    }


FIELDS = 'id, org_name, license_key, valid_until, seats, contact, note, status, activations, created_at'


def _seat_check(cur, lic_id: int, machine: str, machine_name: str, seats: int) -> int:
    '''Учёт компьютеров. Возвращает число машин, если мест не хватает,
    и ноль, когда всё в порядке. Знакомая машина пропускается всегда —
    иначе лицензия слетала бы при каждом обычном запуске'''
    if not machine:
        return 0

    cur.execute(
        f"SELECT 1 FROM {SCHEMA}.license_machines "
        f"WHERE license_id = {lic_id} AND machine_id = '{machine}'"
    )
    known = cur.fetchone() is not None

    if known:
        cur.execute(
            f"UPDATE {SCHEMA}.license_machines SET last_seen = NOW(), machine_name = '{machine_name}' "
            f"WHERE license_id = {lic_id} AND machine_id = '{machine}'"
        )
        return 0

    # Новая машина: считаем занятые места за последние полгода.
    # Давно не выходившие на связь компьютеры место не занимают —
    # так лицензия сама освобождается при замене техники
    cur.execute(
        f"SELECT COUNT(*) FROM {SCHEMA}.license_machines "
        f"WHERE license_id = {lic_id} AND last_seen > NOW() - INTERVAL '180 days'"
    )
    used = int(cur.fetchone()[0])

    if used >= max(1, seats):
        return used

    cur.execute(
        f"INSERT INTO {SCHEMA}.license_machines (license_id, machine_id, machine_name) "
        f"VALUES ({lic_id}, '{machine}', '{machine_name}') "
        f"ON CONFLICT (license_id, machine_id) DO UPDATE SET last_seen = NOW()"
    )
    return 0


def _module_secret(cur, module: str) -> str:
    '''Ключ расшифровки модуля. Создаётся один раз и дальше берётся из базы —
    иначе уже собранные версии программы перестали бы работать'''
    cur.execute(
        f"SELECT secret FROM {SCHEMA}.module_keys "
        f"WHERE module = '{module}' AND is_active = TRUE ORDER BY id DESC LIMIT 1"
    )
    row = cur.fetchone()
    if row:
        return row[0]

    secret = ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(48))
    cur.execute(
        f"INSERT INTO {SCHEMA}.module_keys (module, secret) VALUES ('{module}', '{secret}')"
    )
    return secret


def _sign_result(cur, key: str, machine: str, result: dict) -> dict:
    '''Подписанный ответ. Внутри — тот же вердикт, плюс отпечаток машины
    и время: чужой или старый ответ подставить не выйдет'''
    payload = {
        'key': key,
        'machine': machine,
        'valid': bool(result.get('valid')),
        'org': result.get('org_name', ''),
        'until': result.get('valid_until', ''),
        'issued': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    private_pem, _ = ensure_keys(cur, SCHEMA)
    text, sig = sign_payload(private_pem, payload)

    # Отдаём подписанные данные СТРОКОЙ: программа проверяет подпись
    # ровно по тем байтам, что подписал сервер. Если пересобрать их
    # из объекта, порядок полей может измениться и подпись «сломается»
    return {'payload': text, 'sig': sig}


def handler(event, context):
    '''Управление ключами активации: список, создание, изменение, удаление и публичная проверка ключа'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    body = {}
    if event.get('body'):
        body = json.loads(event['body'])
    params = event.get('queryStringParameters') or {}
    action = body.get('action') or params.get('action', '')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    if action == 'verify':
        key = _esc(str(body.get('key') or params.get('key', '')).strip().upper())
        headers = event.get('headers') or {}
        ip = _esc((event.get('requestContext') or {}).get('identity', {}).get('sourceIp', ''))[:60]
        agent = _esc(headers.get('User-Agent') or headers.get('user-agent') or '')[:240]

        # Программа может спросить о новой версии тем же запросом —
        # это вдвое сокращает число обращений при запуске
        app_ver = str(body.get('app_version') or params.get('app_version', '')).strip()

        if not key:
            cur.close()
            conn.close()
            return _resp(400, {'valid': False, 'error': 'Ключ не указан'})

        # Отпечаток компьютера: программа считает его сама и присылает.
        # По нему видно, на скольких машинах работает один ключ
        machine = _esc(str(body.get('machine_id', '')).strip())[:60]
        machine_name = _esc(str(body.get('machine_name', '')).strip())[:200]

        cur.execute(
            f"SELECT id, org_name, valid_until, status, seats FROM {SCHEMA}.licenses WHERE license_key = '{key}'"
        )
        row = cur.fetchone()

        def log(lic_id, outcome):
            lid = str(lic_id) if lic_id else 'NULL'
            cur.execute(
                f"INSERT INTO {SCHEMA}.license_checks (license_id, license_key, result, ip, user_agent) "
                f"VALUES ({lid}, '{key}', '{outcome}', '{ip}', '{agent}')"
            )

        if not row:
            log(None, 'not_found')
            result = {'valid': False, 'reason': 'Ключ не найден'}
            result['signed'] = _sign_result(cur, key, machine, result)
            if app_ver:
                result['update'] = _latest_release(cur, app_ver)
            cur.close()
            conn.close()
            return _resp(200, result)

        lic_id, org, until, status, seats = row
        today = datetime.utcnow().date()
        if status != 'active':
            log(lic_id, 'blocked')
            result = {'valid': False, 'reason': 'Ключ заблокирован', 'org_name': org}
        elif until < today:
            log(lic_id, 'expired')
            result = {'valid': False, 'reason': 'Срок действия истёк', 'org_name': org, 'valid_until': str(until)}
        else:
            over = _seat_check(cur, lic_id, machine, machine_name, int(seats or 1))
            if over:
                log(lic_id, 'seats_exceeded')
                result = {
                    'valid': False,
                    'reason': f'Ключ уже используется на {over} компьютерах — оплачено мест: {seats}',
                    'org_name': org,
                }
            else:
                log(lic_id, 'ok')
                result = {
                    'valid': True,
                    'org_name': org,
                    'valid_until': str(until),
                    'days_left': (until - today).days,
                }
                cur.execute(
                    f"UPDATE {SCHEMA}.licenses SET activations = activations + 1, last_check_at = NOW() WHERE license_key = '{key}'"
                )

        # Ответ подписываем: программа примет его, только если подпись
        # сходится с публичным ключом внутри неё
        result['signed'] = _sign_result(cur, key, machine, result)

        if app_ver:
            result['update'] = _latest_release(cur, app_ver)

        cur.close()
        conn.close()
        return _resp(200, result)

    if action == 'module_key':
        # Ключ к платному модулю. Выдаётся только по действующей лицензии:
        # без него зашифрованный модуль не запустится, а в программе
        # его нет — снять замок правкой программы не выйдет
        key = _esc(str(body.get('key') or '').strip().upper())
        module = _esc(str(body.get('module') or 'ocr').strip().lower())[:30]
        machine = _esc(str(body.get('machine_id', '')).strip())[:60]

        if not key:
            cur.close()
            conn.close()
            return _resp(403, {'error': 'Нужна полная версия'})

        cur.execute(
            f"SELECT id, valid_until, status FROM {SCHEMA}.licenses WHERE license_key = '{key}'"
        )
        row = cur.fetchone()
        today = datetime.utcnow().date()

        if not row or row[2] != 'active' or row[1] < today:
            cur.close()
            conn.close()
            return _resp(403, {'error': 'Нужна полная версия'})

        # Ключ модуля должен быть привязан к машине: иначе его можно было бы
        # получить один раз и раздать вместе со взломанной программой
        if machine:
            cur.execute(
                f"SELECT 1 FROM {SCHEMA}.license_machines "
                f"WHERE license_id = {row[0]} AND machine_id = '{machine}'"
            )
            if cur.fetchone() is None:
                cur.close()
                conn.close()
                return _resp(403, {'error': 'Этот компьютер не активирован'})

        secret = _module_secret(cur, module)
        cur.close()
        conn.close()
        return _resp(200, {'secret': secret})

    if not _auth(cur, event, body):
        cur.close()
        conn.close()
        return _resp(401, {'error': 'Нет доступа'})

    if action == 'build_info':
        # Ключи, нужные при сборке программы. Доступны только из панели:
        # обычный пользователь их не получит
        _, public_pem = ensure_keys(cur, SCHEMA)
        info = {
            'module_key': _module_secret(cur, 'ocr'),
            'public_key': public_key_raw(public_pem),
        }
        cur.close()
        conn.close()
        return _resp(200, info)

    if action == 'public_key':
        _, public_pem = ensure_keys(cur, SCHEMA)
        raw = public_key_raw(public_pem)
        cur.close()
        conn.close()
        return _resp(200, {'public_key': raw})

    if action == 'machines':
        lic_id = int(body.get('id') or params.get('id') or 0)
        cur.execute(
            f"SELECT machine_id, machine_name, first_seen, last_seen FROM {SCHEMA}.license_machines "
            f"WHERE license_id = {lic_id} ORDER BY last_seen DESC LIMIT 200"
        )
        items = [
            {
                'machine_id': r[0],
                'machine_name': r[1] or '',
                'first_seen': r[2].strftime('%Y-%m-%d %H:%M') if r[2] else '',
                'last_seen': r[3].strftime('%Y-%m-%d %H:%M') if r[3] else '',
            }
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
        return _resp(200, {'items': items})

    if action == 'list' or (method == 'GET' and not action):
        search = _esc(params.get('search', '').strip())
        where = ''
        if search:
            where = f"WHERE org_name ILIKE '%{search}%' OR license_key ILIKE '%{search}%'"
        cur.execute(f"SELECT {FIELDS} FROM {SCHEMA}.licenses {where} ORDER BY created_at DESC LIMIT 500")
        items = [_row(r) for r in cur.fetchall()]
        today = datetime.utcnow().date()
        stats = {
            'total': len(items),
            'active': sum(1 for i in items if i['status'] == 'active' and i['valid_until'] >= str(today)),
            'expired': sum(1 for i in items if i['valid_until'] < str(today)),
            'blocked': sum(1 for i in items if i['status'] != 'active'),
        }
        cur.close()
        conn.close()
        return _resp(200, {'items': items, 'stats': stats})

    if action == 'history':
        lic_id = int(body.get('id') or params.get('id') or 0)
        limit = min(int(body.get('limit') or 200), 500)
        where = f"WHERE c.license_id = {lic_id}" if lic_id else ''
        cur.execute(
            f"SELECT c.id, c.license_key, c.result, c.ip, c.user_agent, c.checked_at, "
            f"COALESCE(l.org_name, '') FROM {SCHEMA}.license_checks c "
            f"LEFT JOIN {SCHEMA}.licenses l ON l.id = c.license_id {where} "
            f"ORDER BY c.checked_at DESC LIMIT {limit}"
        )
        items = [
            {
                'id': r[0],
                'license_key': r[1],
                'result': r[2],
                'ip': r[3] or '',
                'user_agent': r[4] or '',
                'checked_at': r[5].strftime('%Y-%m-%d %H:%M') if r[5] else '',
                'org_name': r[6],
            }
            for r in cur.fetchall()
        ]
        cur.execute(
            f"SELECT result, COUNT(*) FROM {SCHEMA}.license_checks "
            f"{'WHERE license_id = ' + str(lic_id) if lic_id else ''} GROUP BY result"
        )
        by_result = {r[0]: r[1] for r in cur.fetchall()}
        cur.close()
        conn.close()
        return _resp(200, {'items': items, 'by_result': by_result})

    if action == 'generate_key':
        for _ in range(10):
            key = _gen_key()
            cur.execute(f"SELECT 1 FROM {SCHEMA}.licenses WHERE license_key = '{key}'")
            if not cur.fetchone():
                cur.close()
                conn.close()
                return _resp(200, {'key': key})
        cur.close()
        conn.close()
        return _resp(500, {'error': 'Не удалось создать ключ'})

    if action == 'create':
        org = _esc(str(body.get('org_name', '')).strip())
        if not org:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Укажите название организации'})
        key = _esc(str(body.get('license_key', '')).strip().upper()) or _gen_key()
        until = _esc(body.get('valid_until') or (datetime.utcnow().date() + timedelta(days=365)).strftime('%Y-%m-%d'))
        seats = int(body.get('seats') or 1)
        contact = _esc(body.get('contact', ''))
        note = _esc(body.get('note', ''))
        status = _esc(body.get('status', 'active'))

        cur.execute(f"SELECT 1 FROM {SCHEMA}.licenses WHERE license_key = '{key}'")
        if cur.fetchone():
            cur.close()
            conn.close()
            return _resp(409, {'error': 'Такой ключ уже существует'})

        cur.execute(
            f"INSERT INTO {SCHEMA}.licenses (org_name, license_key, valid_until, seats, contact, note, status) "
            f"VALUES ('{org}', '{key}', '{until}', {seats}, '{contact}', '{note}', '{status}') RETURNING {FIELDS}"
        )
        item = _row(cur.fetchone())
        cur.close()
        conn.close()
        return _resp(200, {'item': item})

    if action == 'update':
        lic_id = int(body.get('id') or 0)
        if not lic_id:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Не указана лицензия'})
        sets = []
        if 'org_name' in body:
            sets.append(f"org_name = '{_esc(body['org_name'])}'")
        if 'license_key' in body and body['license_key']:
            sets.append(f"license_key = '{_esc(str(body['license_key']).upper())}'")
        if 'valid_until' in body:
            sets.append(f"valid_until = '{_esc(body['valid_until'])}'")
        if 'seats' in body:
            sets.append(f"seats = {int(body['seats'] or 1)}")
        if 'contact' in body:
            sets.append(f"contact = '{_esc(body['contact'])}'")
        if 'note' in body:
            sets.append(f"note = '{_esc(body['note'])}'")
        if 'status' in body:
            sets.append(f"status = '{_esc(body['status'])}'")
        if not sets:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Нет изменений'})
        sets.append('updated_at = NOW()')
        cur.execute(
            f"UPDATE {SCHEMA}.licenses SET {', '.join(sets)} WHERE id = {lic_id} RETURNING {FIELDS}"
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return _resp(404, {'error': 'Лицензия не найдена'})
        return _resp(200, {'item': _row(row)})

    if action == 'delete':
        lic_id = int(body.get('id') or 0)
        cur.execute(f"UPDATE {SCHEMA}.licenses SET status = 'deleted', updated_at = NOW() WHERE id = {lic_id}")
        cur.close()
        conn.close()
        return _resp(200, {'ok': True})

    cur.close()
    conn.close()
    return _resp(400, {'error': 'Неизвестное действие'})