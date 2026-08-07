import json
import os
import hashlib
import secrets
from datetime import datetime, timedelta

import psycopg2


CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
}

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')


def _hash(login: str, password: str) -> str:
    return hashlib.sha256(f'pv-pdf::{login}::{password}'.encode()).hexdigest()


def _esc(v: str) -> str:
    return str(v).replace("'", "''")


def _resp(code: int, body: dict) -> dict:
    return {'statusCode': code, 'headers': CORS, 'isBase64Encoded': False, 'body': json.dumps(body, ensure_ascii=False)}


def handler(event, context):
    '''Вход администратора, выход и проверка сессии для панели лицензий'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'isBase64Encoded': False, 'body': ''}

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()

    params = event.get('queryStringParameters') or {}
    action = params.get('action', '')
    body = {}
    if event.get('body'):
        body = json.loads(event['body'])
    action = body.get('action', action)

    headers = event.get('headers') or {}
    token = headers.get('X-Auth-Token') or headers.get('x-auth-token') or body.get('token', '')

    if action == 'login':
        login = str(body.get('login', '')).strip()
        password = str(body.get('password', ''))
        if not login or not password:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Укажите логин и пароль'})

        cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.admins")
        total = cur.fetchone()[0]

        if total == 0:
            cur.execute(
                f"INSERT INTO {SCHEMA}.admins (login, pass_hash) VALUES ('{_esc(login)}', '{_hash(login, password)}') RETURNING id"
            )
            admin_id = cur.fetchone()[0]
            created = True
        else:
            cur.execute(
                f"SELECT id FROM {SCHEMA}.admins WHERE login = '{_esc(login)}' AND pass_hash = '{_hash(login, password)}'"
            )
            row = cur.fetchone()
            if not row:
                cur.close()
                conn.close()
                return _resp(401, {'error': 'Неверный логин или пароль'})
            admin_id = row[0]
            created = False

        new_token = secrets.token_urlsafe(32)
        expires = (datetime.utcnow() + timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')
        cur.execute(
            f"INSERT INTO {SCHEMA}.admin_sessions (token, admin_id, expires_at) VALUES ('{new_token}', {admin_id}, '{expires}')"
        )
        cur.close()
        conn.close()
        return _resp(200, {'token': new_token, 'login': login, 'first_run': created})

    if action == 'check':
        if not token:
            cur.close()
            conn.close()
            return _resp(401, {'error': 'Нет доступа'})
        cur.execute(
            f"SELECT a.login FROM {SCHEMA}.admin_sessions s JOIN {SCHEMA}.admins a ON a.id = s.admin_id "
            f"WHERE s.token = '{_esc(token)}' AND s.expires_at > NOW()"
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return _resp(401, {'error': 'Сессия истекла'})
        return _resp(200, {'login': row[0], 'ok': True})

    if action == 'logout':
        if token:
            cur.execute(f"UPDATE {SCHEMA}.admin_sessions SET expires_at = NOW() WHERE token = '{_esc(token)}'")
        cur.close()
        conn.close()
        return _resp(200, {'ok': True})

    if action == 'change_password':
        cur.execute(
            f"SELECT a.id, a.login FROM {SCHEMA}.admin_sessions s JOIN {SCHEMA}.admins a ON a.id = s.admin_id "
            f"WHERE s.token = '{_esc(token)}' AND s.expires_at > NOW()"
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return _resp(401, {'error': 'Нет доступа'})
        new_pass = str(body.get('password', ''))
        if len(new_pass) < 6:
            cur.close()
            conn.close()
            return _resp(400, {'error': 'Пароль должен быть не короче 6 символов'})
        cur.execute(
            f"UPDATE {SCHEMA}.admins SET pass_hash = '{_hash(row[1], new_pass)}' WHERE id = {row[0]}"
        )
        cur.close()
        conn.close()
        return _resp(200, {'ok': True})

    cur.close()
    conn.close()
    return _resp(400, {'error': 'Неизвестное действие'})
