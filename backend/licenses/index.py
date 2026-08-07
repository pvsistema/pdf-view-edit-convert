import json
import os
import random
import string
from datetime import datetime, timedelta

import psycopg2


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
        if not key:
            cur.close()
            conn.close()
            return _resp(400, {'valid': False, 'error': 'Ключ не указан'})
        cur.execute(
            f"SELECT org_name, valid_until, status FROM {SCHEMA}.licenses WHERE license_key = '{key}'"
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return _resp(200, {'valid': False, 'reason': 'Ключ не найден'})
        org, until, status = row
        today = datetime.utcnow().date()
        if status != 'active':
            result = {'valid': False, 'reason': 'Ключ заблокирован', 'org_name': org}
        elif until < today:
            result = {'valid': False, 'reason': 'Срок действия истёк', 'org_name': org, 'valid_until': str(until)}
        else:
            result = {'valid': True, 'org_name': org, 'valid_until': str(until), 'days_left': (until - today).days}
            cur.execute(
                f"UPDATE {SCHEMA}.licenses SET activations = activations + 1, last_check_at = NOW() WHERE license_key = '{key}'"
            )
        cur.close()
        conn.close()
        return _resp(200, result)

    if not _auth(cur, event, body):
        cur.close()
        conn.close()
        return _resp(401, {'error': 'Нет доступа'})

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
