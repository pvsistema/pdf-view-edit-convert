#!/usr/bin/env bash
# ============================================================
#  ПВ-Система PDF — сборка Linux-версии
#
#  Запуск из любой папки:
#      bash desktop/linux/build.sh            — .deb и .rpm
#      bash desktop/linux/build.sh deb        — только .deb (Astra Linux)
#      bash desktop/linux/build.sh rpm        — только .rpm (РЕД ОС, Альт)
#      bash desktop/linux/build.sh noweb      — не пересобирать интерфейс
#      bash desktop/linux/build.sh arm64      — для процессоров ARM (Байкал-М)
#
#  Готовые пакеты: desktop/linux/out/
#
#  Windows-версию (desktop/csharp) этот скрипт не трогает.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="$SCRIPT_DIR/PvsPdfLinux"
WORK="$SCRIPT_DIR/build"
OUT="$SCRIPT_DIR/out"
LOG="$SCRIPT_DIR/build.log"

MAKE_DEB=1
MAKE_RPM=1
BUILD_WEB=1
ARCH="x64"
for a in "$@"; do
  case "$a" in
    deb) MAKE_DEB=1; MAKE_RPM=0 ;;
    rpm) MAKE_DEB=0; MAKE_RPM=1 ;;
    noweb) BUILD_WEB=0 ;;
    arm64) ARCH="arm64" ;;
    *) echo "Неизвестный параметр: $a"; exit 2 ;;
  esac
done

case "$ARCH" in
  x64)   RID="linux-x64";   DEB_ARCH="amd64"; RPM_ARCH="x86_64" ;;
  arm64) RID="linux-arm64"; DEB_ARCH="arm64"; RPM_ARCH="aarch64" ;;
esac

step() { echo; echo "== $* =="; }
fail() { echo; echo "ОШИБКА: $*"; echo "Полный журнал: $LOG"; exit 1; }

: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

VERSION="$(tr -d ' \r\n' < "$ROOT/desktop/APP_VERSION" 2>/dev/null || true)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || VERSION="1.0.0"

echo "============================================================"
echo "  ПВ-Система PDF — сборка Linux-версии"
echo "  Проект:      $ROOT"
echo "  Версия:      $VERSION"
echo "  Архитектура: $ARCH"
echo "============================================================"

# ---------- [0/5] Проверка окружения ----------
step "[0/5] Проверяю окружение"

command -v dotnet >/dev/null || fail ".NET 8 SDK не найден. Установка: https://learn.microsoft.com/dotnet/core/install/linux
       (Astra/Debian: пакет dotnet-sdk-8.0; РЕД ОС: sudo dnf install dotnet-sdk-8.0)"
dotnet --list-sdks | grep -q '^8\.' || fail "Нужен именно .NET 8 SDK. Установлены: $(dotnet --list-sdks | tr '\n' ' ')"
echo "  .NET 8 SDK: OK"

if [[ $BUILD_WEB == 1 ]]; then
  command -v node >/dev/null || fail "Node.js не найден (нужна версия 18 или новее): https://nodejs.org"
  echo "  Node.js: $(node --version)"
fi

if [[ $MAKE_DEB == 1 ]]; then
  command -v dpkg-deb >/dev/null || fail "Для пакета .deb нужна команда dpkg-deb.
       Astra/Debian — она уже есть; РЕД ОС: sudo dnf install dpkg
       Или соберите только rpm: bash desktop/linux/build.sh rpm"
  echo "  dpkg-deb: OK"
fi
if [[ $MAKE_RPM == 1 ]]; then
  command -v rpmbuild >/dev/null || fail "Для пакета .rpm нужна команда rpmbuild.
       РЕД ОС: sudo dnf install rpm-build;  Astra/Debian: sudo apt install rpm
       Или соберите только deb: bash desktop/linux/build.sh deb"
  echo "  rpmbuild: OK"
fi

# ---------- [1/5] Интерфейс ----------
step "[1/5] Собираю интерфейс"
if [[ $BUILD_WEB == 1 ]]; then
  cd "$ROOT"
  [[ -f vite.config.desktop.ts ]] || fail "Нет файла vite.config.desktop.ts — скопируйте проект целиком"
  npm install
  npx --no-install vite build --config vite.config.desktop.ts
  [[ -f dist-desktop/index.html ]] || fail "Интерфейс не собрался — нет dist-desktop/index.html"

  # Ключ защиты платного модуля распознавания — тот же, что для Windows
  KEY="${PVSPDF_MODULE_KEY:-}"
  if [[ -z "$KEY" && -f "$ROOT/desktop/module.key" ]]; then
    KEY="$(tr -d ' \r\n' < "$ROOT/desktop/module.key")"
  fi
  if [[ -n "$KEY" ]]; then
    node "$ROOT/scripts/encrypt-module.mjs" "$ROOT/dist-desktop" "$KEY"
    echo "  Модуль распознавания защищён"
  else
    echo "  ВНИМАНИЕ: нет desktop/module.key — модуль распознавания НЕ защищён"
  fi
else
  [[ -f "$ROOT/dist-desktop/index.html" ]] || fail "Режим noweb, но интерфейс ещё не собран"
  echo "  Пропущено (noweb) — беру готовый dist-desktop"
fi

# ---------- [2/5] Программа ----------
step "[2/5] Собираю программу ($RID)"
rm -rf "$WORK"
mkdir -p "$WORK/app"
cd "$APP_DIR"
rm -rf bin obj
dotnet publish -c Release -r "$RID" --self-contained true \
  -p:Version="$VERSION" \
  -p:PublishSingleFile=false \
  -p:DebugType=none \
  -o "$WORK/app"
[[ -f "$WORK/app/pvspdf" ]] || fail "Программа не собралась"

# Ядро окна. Готовое из пакета рассчитано на WebKitGTK 4.0 — так работает
# на Astra Linux 1.7 и большинстве систем. На новых системах, где осталась
# только версия 4.1 (свежие Альт, РЕД ОС 8), пересобираем его под неё
NATIVE="$WORK/app/Photino.Native.so"
if command -v pkg-config >/dev/null && command -v g++ >/dev/null \
   && ! pkg-config --exists webkit2gtk-4.0 && pkg-config --exists webkit2gtk-4.1 libnotify gtk+-3.0; then
  echo "  В системе WebKitGTK 4.1 — пересобираю ядро окна"
  SRC="$WORK/photino-src"
  mkdir -p "$SRC"
  curl -sSL https://codeload.github.com/tryphotino/photino.Native/tar.gz/refs/tags/v3.1.6 | tar xz -C "$SRC" --strip-components=1
  g++ -std=c++2a -O2 -shared -fPIC -o "$NATIVE" \
    "$SRC/Photino.Native/Photino.Linux.Dialog.cpp" \
    "$SRC/Photino.Native/Photino.Linux.cpp" \
    "$SRC/Photino.Native/Exports.cpp" \
    $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1 libnotify) \
    || fail "Не удалось пересобрать ядро окна. Нужны пакеты разработки: gtk3-devel, webkit2gtk4.1-devel, libnotify-devel"
  WEBKIT="4.1"
else
  WEBKIT="4.0"
fi
[[ -f "$NATIVE" ]] || fail "Нет ядра окна Photino.Native.so"
echo "  Ядро окна: WebKitGTK $WEBKIT"
echo "  OK"

# ---------- [3/5] Комплект файлов ----------
step "[3/5] Собираю комплект файлов"
cp -r "$ROOT/dist-desktop" "$WORK/app/web"
printf '%s' "$VERSION" > "$WORK/app/app_version.txt"
ICON_SRC="$ROOT/public/icon-512.png"
[[ -f "$ICON_SRC" ]] || ICON_SRC="$ROOT/public/app-icon.png"
cp "$ICON_SRC" "$WORK/app/pvspdf.png"
chmod 755 "$WORK/app/pvspdf"

# Общая раскладка: /opt/pvspdf — программа, /usr/bin/pvspdf — запуск,
# ярлык в меню и связь с файлами PDF
make_tree() {
  local root="$1" kind="$2"
  mkdir -p "$root/opt/pvspdf" "$root/usr/bin" "$root/usr/share/applications" \
           "$root/usr/share/icons/hicolor/512x512/apps" "$root/usr/share/pixmaps"
  cp -r "$WORK/app/." "$root/opt/pvspdf/"
  printf '%s' "$kind" > "$root/opt/pvspdf/package_kind.txt"

  cat > "$root/usr/bin/pvspdf" <<'EOF'
#!/bin/sh
# Запуск ПВ-Система PDF
# На части видеокарт встроенный браузер рисует пустое окно с ускорением —
# выключаем его: для работы с документами оно не нужно
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
exec /opt/pvspdf/pvspdf "$@"
EOF
  chmod 755 "$root/usr/bin/pvspdf"

  cp "$WORK/app/pvspdf.png" "$root/usr/share/icons/hicolor/512x512/apps/pvspdf.png"
  cp "$WORK/app/pvspdf.png" "$root/usr/share/pixmaps/pvspdf.png"

  cat > "$root/usr/share/applications/pvspdf.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=ПВ-Система PDF
GenericName=Редактор PDF
Comment=Просмотр, правка, печать и преобразование документов PDF
Exec=/usr/bin/pvspdf %F
Icon=pvspdf
Terminal=false
Categories=Office;Viewer;Graphics;
MimeType=application/pdf;
Keywords=pdf;редактор;документ;скан;
StartupWMClass=pvspdf
EOF
}

# Действия после установки и удаления — общие для deb и rpm
POSTINST='#!/bin/sh
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0'

# ---------- [4/5] Пакеты ----------
step "[4/5] Собираю пакеты"
rm -rf "$OUT"
mkdir -p "$OUT"

INSTALLED_KB=$(du -sk "$WORK/app" | cut -f1)

if [[ $MAKE_DEB == 1 ]]; then
  if [[ $WEBKIT == "4.1" ]]; then WK_DEB="libwebkit2gtk-4.1-0"; else WK_DEB="libwebkit2gtk-4.0-37"; fi
  D="$WORK/deb"
  make_tree "$D" deb
  mkdir -p "$D/DEBIAN"
  cat > "$D/DEBIAN/control" <<EOF
Package: pvspdf
Version: $VERSION
Section: office
Priority: optional
Architecture: $DEB_ARCH
Installed-Size: $INSTALLED_KB
Maintainer: ПВ-Система <support@pvsystem.ru>
Depends: $WK_DEB, libgtk-3-0, libnotify4, zlib1g
Recommends: cups-client, sane-utils, zenity, xdg-utils, policykit-1
Suggests: sane-airscan, simple-scan, xsane
Description: ПВ-Система PDF — редактор документов PDF
 Просмотр, правка, печать, сканирование и преобразование документов PDF.
EOF
  printf '%s\n' "$POSTINST" > "$D/DEBIAN/postinst"
  printf '%s\n' "$POSTINST" > "$D/DEBIAN/postrm"
  chmod 755 "$D/DEBIAN/postinst" "$D/DEBIAN/postrm"
  DEB_FILE="$OUT/pvspdf_${VERSION}_${DEB_ARCH}.deb"
  dpkg-deb --root-owner-group --build "$D" "$DEB_FILE" >/dev/null 2>&1 \
    || dpkg-deb --build "$D" "$DEB_FILE"
  echo "  OK — $DEB_FILE"
fi

if [[ $MAKE_RPM == 1 ]]; then
  RPM_SUFFIX="()(64bit)"
  if [[ $WEBKIT == "4.1" ]]; then RPM_WEBKIT="libwebkit2gtk-4.1.so.0$RPM_SUFFIX"; else RPM_WEBKIT="libwebkit2gtk-4.0.so.37$RPM_SUFFIX"; fi
  R="$WORK/rpm"
  mkdir -p "$R/BUILD" "$R/RPMS" "$R/SPECS" "$R/BUILDROOT" "$R/SOURCES" "$R/SRPMS"
  TREE="$WORK/rpmtree"
  make_tree "$TREE" rpm
  cat > "$R/SPECS/pvspdf.spec" <<EOF
Name:           pvspdf
Version:        $VERSION
Release:        1
Summary:        ПВ-Система PDF — редактор документов PDF
License:        Proprietary
URL:            https://pvsystem.ru
BuildArch:      $RPM_ARCH
AutoReqProv:    no
# Зависимости по именам библиотек, а не пакетов: в РЕД ОС и Альт пакеты
# называются по-разному, а имена библиотек одинаковые
Requires:       $RPM_WEBKIT
Requires:       libgtk-3.so.0$RPM_SUFFIX
Requires:       libnotify.so.4$RPM_SUFFIX

%global debug_package %{nil}
%global __strip /bin/true
%global _build_id_links none

%description
Просмотр, правка, печать, сканирование и преобразование документов PDF.

%install
mkdir -p %{buildroot}
cp -a "$TREE/." %{buildroot}/

%post
$POSTINST

%postun
$POSTINST

%files
/opt/pvspdf
/usr/bin/pvspdf
/usr/share/applications/pvspdf.desktop
/usr/share/icons/hicolor/512x512/apps/pvspdf.png
/usr/share/pixmaps/pvspdf.png
EOF
  rpmbuild --define "_topdir $R" -bb "$R/SPECS/pvspdf.spec" || fail "Пакет rpm не собрался"
  RPM_FILE="$OUT/pvspdf-${VERSION}-1.${RPM_ARCH}.rpm"
  cp "$R/RPMS/$RPM_ARCH/"*.rpm "$RPM_FILE"
  echo "  OK — $RPM_FILE"
fi

# ---------- [5/5] Готово ----------
step "[5/5] Готово"
ls -lh "$OUT"
echo
echo "Установка у пользователя:"
[[ $MAKE_DEB == 1 ]] && echo "  Astra Linux:     sudo apt install ./$(basename "${DEB_FILE:-pvspdf.deb}")"
[[ $MAKE_RPM == 1 ]] && echo "  РЕД ОС:          sudo dnf install ./$(basename "${RPM_FILE:-pvspdf.rpm}")"
[[ $MAKE_RPM == 1 ]] && echo "  Альт:            sudo apt-get install ./$(basename "${RPM_FILE:-pvspdf.rpm}")"
echo
echo "Для автообновления: выложите пакеты и укажите ссылки на них"
echo "в панели администратора (раздел версий, поля «Пакет Linux»)."
