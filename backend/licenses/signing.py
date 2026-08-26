'''Подпись ответа о лицензии.

Сервер подписывает ответ приватным ключом, программа проверяет подпись
публичным. Подделать ответ, не имея приватного ключа, невозможно:
правка памяти браузера больше не включает полную версию.
'''

import base64
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def ensure_keys(cur, schema: str) -> tuple:
    '''Возвращает действующую пару ключей, создавая её при первом обращении'''
    cur.execute(
        f'SELECT private_pem, public_pem FROM {schema}.signing_keys '
        f'WHERE is_active = TRUE ORDER BY id DESC LIMIT 1'
    )
    row = cur.fetchone()
    if row:
        return row[0], row[1]

    # Кривая P-256: программа проверяет такую подпись штатными
    # средствами Windows, без сторонних библиотек
    private = ec.generate_private_key(ec.SECP256R1())
    private_pem = private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = private.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    esc = private_pem.replace("'", "''")
    esc_pub = public_pem.replace("'", "''")
    cur.execute(
        f"INSERT INTO {schema}.signing_keys (private_pem, public_pem) "
        f"VALUES ('{esc}', '{esc_pub}')"
    )
    return private_pem, public_pem


def public_key_raw(public_pem: str) -> str:
    '''Публичный ключ в виде, который программа читает напрямую'''
    key = serialization.load_pem_public_key(public_pem.encode())
    der = key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return _b64(der)


def sign_payload(private_pem: str, payload: dict) -> tuple:
    '''Подпись данных о лицензии.

    Возвращает пару: подписанный текст и саму подпись. Программе уходит
    именно текст — проверять подпись нужно по тем же байтам, что были
    подписаны, иначе правильный ответ будет выглядеть поддельным
    '''
    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    data = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    sig = key.sign(data.encode(), ec.ECDSA(hashes.SHA256()))
    return data, _b64(sig)