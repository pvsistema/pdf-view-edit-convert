# ПВ-Система PDF — Linux-версия

Отдельная программа для Astra Linux, РЕД ОС, Альт и других Linux.
Интерфейс тот же, что и в Windows-версии. Windows-версию (`desktop/csharp`,
`build.bat`) эта папка **не затрагивает** — она собирается как раньше.

## Что нужно на компьютере сборки

Собирать нужно **на Linux**. Удобнее всего на той системе, под которую
делается пакет: Astra Linux для .deb, РЕД ОС для .rpm.

| Программа | Astra Linux / Debian | РЕД ОС |
|---|---|---|
| .NET 8 SDK | `sudo apt install dotnet-sdk-8.0` или [инструкция Microsoft](https://learn.microsoft.com/dotnet/core/install/linux) | `sudo dnf install dotnet-sdk-8.0` |
| Node.js 18+ | https://nodejs.org | https://nodejs.org |
| Сборка .deb | уже есть (`dpkg-deb`) | `sudo dnf install dpkg` |
| Сборка .rpm | `sudo apt install rpm` | `sudo dnf install rpm-build` |

Ключ защиты модуля распознавания тот же, что для Windows: файл `desktop/module.key`.

## Как собрать

```
bash desktop/linux/build.sh          # оба пакета: .deb и .rpm
bash desktop/linux/build.sh deb      # только .deb — Astra Linux
bash desktop/linux/build.sh rpm      # только .rpm — РЕД ОС, Альт
bash desktop/linux/build.sh arm64    # для процессоров ARM (Байкал-М)
```

Готовые пакеты появятся в `desktop/linux/out`:

```
pvspdf_3.58.1_amd64.deb
pvspdf-3.58.1-1.x86_64.rpm
```

Номер версии берётся из того же файла `desktop/APP_VERSION`, что и для Windows.

## Установка у пользователя

| Система | Команда |
|---|---|
| Astra Linux | `sudo apt install ./pvspdf_3.58.1_amd64.deb` |
| РЕД ОС | `sudo dnf install ./pvspdf-3.58.1-1.x86_64.rpm` |
| Альт | `sudo apt-get install ./pvspdf-3.58.1-1.x86_64.rpm` |

Программа ставится в `/opt/pvspdf`. Ярлык появляется в меню «Офис», и
документы PDF можно открывать в ней двойным щелчком.
Настройки, лицензия и журналы каждого пользователя хранятся в его папке
`~/.local/share/pvspdf`.

## Как это устроено и чем отличается от Windows

| Возможность | Windows | Linux |
|---|---|---|
| Окно программы | WebView2 (Edge) | WebKitGTK |
| Сохранение файлов | окно Windows | окно системы (zenity / kdialog / GTK) |
| Печать | драйвер Windows | CUPS, команда `lp` |
| Сканирование | WIA и TWAIN | SANE (`scanimage`), сетевые МФУ — через `sane-airscan` |
| Лицензия | привязка к номеру установки Windows | привязка к `/etc/machine-id`; сервер и проверка подписи те же |
| Обновление | тихий установщик .exe | пакет .deb/.rpm, система спрашивает пароль администратора |
| Журнал | `C:\PVSPDF\logs` | `~/.local/share/pvspdf/logs` |

Лицензия, купленная на Windows, работает и в Linux, но каждый компьютер
занимает своё место в лицензии, так же как в Windows.

## Сканеры

Для сканирования в системе должен быть SANE:

- Astra Linux: `sudo apt install sane-utils sane-airscan`
- РЕД ОС: `sudo dnf install sane-backends sane-airscan`
- Альт: `sudo apt-get install sane sane-airscan`

USB-аппаратам Kyocera, Pantum, Canon и Brother нужен драйвер SANE с сайта
производителя. Если сканер видит только администратор, добавьте
пользователя в группы `scanner` и `lp`. Кнопка «Отчёт о поиске» в окне
сканирования покажет, на каком шаге теряется аппарат.

## Обновления

Чтобы выпустить обновление:

1. Поднимите номер в `desktop/APP_VERSION`.
2. Соберите Windows (`build.bat installer`) и Linux (`bash desktop/linux/build.sh`).
3. Выложите файлы и в панели администратора (раздел версий) укажите
   три ссылки: на установщик .exe, на пакет .deb и на пакет .rpm.

Linux-программа видит только те выпуски, у которых заполнена ссылка на её
пакет. Если выложить только Windows-версию, Linux-пользователям обновление
не предложат, и ошибки у них не будет.

## Если программа открывается с пустым окном

Такое бывает на старых видеокартах. В команде запуска `/usr/bin/pvspdf`
ускорение отрисовки уже выключено. Если окно всё равно пустое, пришлите
журнал из `~/.local/share/pvspdf/logs`.

## Если сборка прервалась

Полный журнал: `desktop/linux/build.log`.
