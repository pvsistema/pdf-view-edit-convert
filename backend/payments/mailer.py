import os
import smtplib
import ssl
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

# Яндекс и Mail.ru используют один и тот же порт защищённой отправки.
# Сервер определяется по адресу ящика, чтобы не спрашивать его отдельно
HOSTS = {
    'yandex.ru': 'smtp.yandex.ru',
    'ya.ru': 'smtp.yandex.ru',
    'yandex.com': 'smtp.yandex.ru',
    'mail.ru': 'smtp.mail.ru',
    'bk.ru': 'smtp.mail.ru',
    'inbox.ru': 'smtp.mail.ru',
    'list.ru': 'smtp.mail.ru',
    'internet.ru': 'smtp.mail.ru',
}


def _server(user: str) -> str:
    explicit = os.environ.get('SMTP_HOST', '').strip()
    if explicit:
        return explicit
    domain = user.split('@')[-1].lower()
    # Почта на своём домене чаще всего заведена на Яндексе
    return HOSTS.get(domain, 'smtp.yandex.ru')


def ready() -> bool:
    return bool(os.environ.get('SMTP_USER') and os.environ.get('SMTP_PASSWORD'))


def send(to: str, subject: str, text: str, html: str = '', wait: int = 0) -> tuple:
    '''Отправка письма. Возвращает (успех, пояснение) — письмо не должно
    ронять оплату: деньги уже получены, ключ уже выдан.

    wait — сколько секунд ждать почтовый сервер. При оплате ждём мало,
    при отправке вручную из панели можно подождать дольше'''
    user = os.environ.get('SMTP_USER', '').strip()
    password = os.environ.get('SMTP_PASSWORD', '').strip()

    if not user or not password:
        return False, 'Отправка почты не настроена'
    if not to or '@' not in to:
        return False, 'Адрес получателя не указан'

    sender_name = os.environ.get('SMTP_FROM_NAME', 'ПВ-Система PDF')
    host = _server(user)
    port = int(os.environ.get('SMTP_PORT', '465'))

    msg = MIMEMultipart('alternative')
    msg['Subject'] = Header(subject, 'utf-8')
    msg['From'] = formataddr((str(Header(sender_name, 'utf-8')), user))
    msg['To'] = to
    msg['Date'] = formatdate(localtime=True)
    # Без этого заголовка часть почтовых служб считает письмо подозрительным
    msg['Message-ID'] = make_msgid(domain=user.split('@')[-1])

    msg.attach(MIMEText(text, 'plain', 'utf-8'))
    if html:
        msg.attach(MIMEText(html, 'html', 'utf-8'))

    # Ждать почту долго нельзя: вся операция обязана уложиться в отведённое
    # время, иначе банк не увидит ответа и пришлёт уведомление об оплате
    # заново. Ключ к этому моменту уже выдан, поэтому лучше бросить
    # медленную отправку и отправить письмо позже из панели
    wait = wait or int(os.environ.get('SMTP_TIMEOUT', '3'))

    try:
        context = ssl.create_default_context()
        if port == 587:
            with smtplib.SMTP(host, port, timeout=wait) as srv:
                srv.starttls(context=context)
                srv.login(user, password)
                srv.sendmail(user, [to], msg.as_string())
        else:
            with smtplib.SMTP_SSL(host, port, timeout=wait, context=context) as srv:
                srv.login(user, password)
                srv.sendmail(user, [to], msg.as_string())
        return True, 'Письмо отправлено'
    except smtplib.SMTPAuthenticationError:
        return False, 'Почта не пустила: проверьте пароль приложения'
    except Exception as e:
        return False, f'Не удалось отправить письмо: {e}'


MONTHS = (
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
)


def _human_date(value: str) -> str:
    '''Дата по-человечески: «1 сентября 2027» вместо «2027-09-01»'''
    try:
        y, m, d = (int(p) for p in str(value)[:10].split('-'))
        return f'{d} {MONTHS[m - 1]} {y}'
    except (ValueError, IndexError):
        return str(value)


def _places(n: int) -> str:
    '''«2 рабочих места», но «5 рабочих мест» — иначе письмо выглядит
    неряшливо там, где мест куплено несколько'''
    if 11 <= n % 100 <= 14:
        return 'рабочих мест'
    last = n % 10
    if last == 1:
        return 'рабочее место'
    if 2 <= last <= 4:
        return 'рабочих места'
    return 'рабочих мест'


def key_letter(key: str, title: str, until: str, seats: int) -> tuple:
    '''Письмо с ключом. Простой текст обязателен: часть почтовых программ
    показывает именно его, а не оформленный вариант'''
    place = f'{seats} {_places(seats)}' if seats > 1 else 'одно рабочее место'
    until = _human_date(until)

    text = (
        'Здравствуйте!\n\n'
        'Спасибо за покупку. Ваш ключ активации:\n\n'
        f'    {key}\n\n'
        f'Тариф: {title}\n'
        f'Действует до: {until}\n'
        f'Количество: {place}\n\n'
        'Как активировать:\n'
        '1. Откройте программу ПВ-Система PDF\n'
        '2. Нажмите «Активировать полную версию»\n'
        '3. Введите ключ и нажмите «Активировать»\n\n'
        'Сохраните это письмо: ключ понадобится при переустановке '
        'программы или установке на другой компьютер.\n\n'
        'Если что-то не получается — просто ответьте на это письмо.\n'
    )

    html = f'''<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f2;font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14181C">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e2de">
<div style="background:#14181C;color:#fff;padding:16px 24px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px">
ПВ-Система PDF
</div>
<div style="padding:24px">
<p style="margin:0 0 18px">Здравствуйте! Спасибо за покупку.</p>

<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8a8a">Ваш ключ активации</p>
<div style="border:1px solid #14181C;padding:14px;text-align:center;font-size:18px;font-weight:700;letter-spacing:.06em;background:#fafaf8">
{key}
</div>

<table style="width:100%;margin:22px 0;border-collapse:collapse;font-size:14px">
<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8a8a8a">Тариф</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">{title}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8a8a8a">Действует до</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">{until}</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8a8a8a">Количество</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">{place}</td></tr>
</table>

<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a8a8a">Как активировать</p>
<ol style="margin:0 0 18px;padding-left:20px">
<li>Откройте программу ПВ-Система PDF</li>
<li>Нажмите «Активировать полную версию»</li>
<li>Введите ключ и нажмите «Активировать»</li>
</ol>

<p style="margin:0;padding:12px;background:#fafaf8;border-left:2px solid #14181C;font-size:13px;color:#555">
Сохраните это письмо: ключ понадобится при переустановке программы
или установке на другой компьютер.
</p>
</div>
</div>
</body></html>'''

    return text, html