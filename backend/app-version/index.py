import json
import os
from datetime import datetime

import psycopg2


CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')


def _esc(v) -> str:
    return str(v).replace("'", "''")


def _resp(code: int, body: dict) -> dict:
    return {'statusCode': code, 'headers': CORS, 'isBase64Encoded': False, 'body': json.dumps(body, ensure_ascii=False, default=str)}


def _num(v: str):
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


def _setting(cur, key: str, default: str = '') -> str:
    '''Читает общую настройку программы. Нет записи — берём значение по умолчанию'''
    cur.execute(f"SELECT value FROM {SCHEMA}.app_settings WHERE key = '{_esc(key)}'")
    row = cur.fetchone()
    return (row[0] if row and row[0] is not None else default)


def _outdated(cur, current: str) -> dict:
    '''Проверяет, не старее ли версия у человека той, что задана в панели.

    Пустая настройка означает, что блокировка выключена — так и задумано:
    включать её должен администратор осознанно
    '''
    min_ver = (_setting(cur, 'min_version') or '').strip()
    if not min_ver:
        return {'blocked': False, 'min_version': ''}
    return {
        'blocked': _num(current) < _num(min_ver),
        'min_version': min_ver,
    }


def _auth(cur, event, body) -> bool:
    headers = event.get('headers') or {}
    token = headers.get('X-Auth-Token') or headers.get('x-auth-token') or body.get('token', '')
    if not token:
        return False
    cur.execute(f"SELECT 1 FROM {SCHEMA}.admin_sessions WHERE token = '{_esc(token)}' AND expires_at > NOW()")
    return cur.fetchone() is not None


def handler(event, context):
    '''Публикация и проверка версии программы: клиент узнаёт о новой версии, администратор публикует обновление'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    body = {}
    if event.get('body'):
        body = json.loads(event['body'])
    params = event.get('queryStringParameters') or {}
    action = body.get('action') or params.get('action', 'check')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    if action == 'check':
        current = _esc(str(body.get('version') or params.get('version', '0.0.0')).strip())

        # Заодно сообщаем, сколько проб этот компьютер уже израсходовал.
        # Отдельного обращения не нужно: о версии программа спрашивает
        # при запуске в любом случае. Так очистка памяти программы
        # перестаёт обнулять пробный счёт
        machine = _esc(str(body.get('machine_id') or params.get('machine_id', '')).strip())[:60]
        trial_used = None
        if machine:
            # Считаем строго по отпечатку компьютера. По сетевому адресу
            # считать нельзя: в конторе весь отдел выходит через один адрес,
            # и пробы одного сотрудника съели бы попытки у всех остальных
            cur.execute(
                f"SELECT COUNT(*) FROM {SCHEMA}.trial_events "
                f"WHERE machine_id = '{machine}' AND event = 'used'"
            )
            trial_used = cur.fetchone()[0] or 0

        cur.execute(
            f"SELECT version, download_url, notes, is_required, published_at "
            f"FROM {SCHEMA}.app_releases WHERE is_published = TRUE "
            f"ORDER BY published_at DESC LIMIT 1"
        )
        row = cur.fetchone()

        # Не пора ли этой версии на покой — решаем до закрытия соединения
        out = dict(_outdated(cur, current))

        cur.close()
        conn.close()

        if trial_used is not None:
            out['trial_used'] = trial_used

        if not row:
            out.update({'update_available': False, 'latest': current})
            return _resp(200, out)

        version, url, notes, required, published = row
        newer = _num(version) > _num(current)
        out.update({
            'update_available': newer,
            'latest': version,
            'download_url': url or '',
            'notes': notes or '',
            'required': bool(required) and newer,
            'published_at': published.strftime('%Y-%m-%d') if published else '',
        })
        return _resp(200, out)

    if not _auth(cur, event, body):
        cur.close()
        conn.close()
        return _resp(401, {'error': 'Нет доступа'})

    if action == 'get_settings':
        cur.execute(
            f"SELECT version FROM {SCHEMA}.app_releases WHERE is_published = TRUE "
            f"ORDER BY published_at DESC LIMIT 1"
        )
        top = cur.fetchone()
        min_ver = _setting(cur, 'min_version')
        cur.close()
        conn.close()
        return _resp(200, {
            'min_version': min_ver,
            'latest_version': top[0] if top else '',
        })

    if action == 'set_min_version':
        ver = str(body.get('min_version', '')).strip()

        # Пустое значение выключает блокировку — это законный случай
        if ver:
            parts = ver.split('.')
            if len(parts) != 3 or not all(p.isdigit() for p in parts):
                cur.close()
                conn.close()
                return _resp(400, {'error': 'Номер версии должен быть вида 1.0.0'})

            # Нельзя требовать версию, которой ещё нет: иначе люди
            # окажутся заперты — обновиться будет не на что
            cur.execute(
                f"SELECT 1 FROM {SCHEMA}.app_releases "
                f"WHERE version = '{_esc(ver)}' AND is_published = TRUE"
            )
            if not cur.fetchone():
                cur.close()
                conn.close()
                return _resp(400, {
                    'error': 'Такая версия не опубликована. Сначала выложите её, '
                             'иначе людям некуда будет обновиться'
                })

        cur.execute(
            f"INSERT INTO {SCHEMA}.app_settings (key, value, updated_at) "
            f"VALUES ('min_version', '{_esc(ver)}', NOW()) "
            f"ON CONFLICT (key) DO UPDATE SET value = '{_esc(ver)}', updated_at = NOW()"
        )
        cur.close()
        conn.close()
        return _resp(200, {'ok': True, 'min_version': ver})

    if action == 'list':
        cur.execute(
            f"SELECT id, version, download_url, notes, is_required, is_published, published_at "
            f"FROM {SCHEMA}.app_releases ORDER BY published_at DESC LIMIT 100"
        )
        items = [
            {
                'id': r[0],
                'version': r[1],
                'download_url': r[2] or '',
                'notes': r[3] or '',
                'is_required': bool(r[4]),
                'is_published': bool(r[5]),
                'published_at': r[6].strftime('%Y-%m-%d %H:%M') if r[6] else '',
            }
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
        return _resp(200, {'items': items})

    if action == 'publish':
        version = _esc(str(body.get('version', '')).strip())
        if not version:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Укажите номер версии'})
        url = _esc(body.get('download_url', ''))
        notes = _esc(body.get('notes', ''))
        required = 'TRUE' if body.get('is_required') else 'FALSE'
        published = 'TRUE' if body.get('is_published', True) else 'FALSE'

        cur.execute(f"SELECT id FROM {SCHEMA}.app_releases WHERE version = '{version}'")
        row = cur.fetchone()
        if row:
            cur.execute(
                f"UPDATE {SCHEMA}.app_releases SET download_url = '{url}', notes = '{notes}', "
                f"is_required = {required}, is_published = {published}, published_at = NOW() WHERE id = {row[0]}"
            )
        else:
            cur.execute(
                f"INSERT INTO {SCHEMA}.app_releases (version, download_url, notes, is_required, is_published) "
                f"VALUES ('{version}', '{url}', '{notes}', {required}, {published})"
            )
        cur.close()
        conn.close()
        return _resp(200, {'ok': True, 'version': version})

    if action == 'unpublish':
        rel_id = int(body.get('id') or 0)
        cur.execute(f"UPDATE {SCHEMA}.app_releases SET is_published = FALSE WHERE id = {rel_id}")
        cur.close()
        conn.close()
        return _resp(200, {'ok': True})

    cur.close()
    conn.close()
    return _resp(400, {'error': 'Неизвестное действие'})