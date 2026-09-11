using System.Runtime.InteropServices;

namespace PvsPdfApp;

// Работа со сканером через службу Windows (WIA). Драйверы ставит сам
// производитель устройства — программа лишь просит у Windows готовые снимки.
// Всё делается на компьютере пользователя, никуда ничего не отправляется
internal static class Scanner
{
    // Свойства снимка в терминах WIA
    const uint DPI_X = 6147;
    const uint DPI_Y = 6148;
    const uint POS_X = 6149;
    const uint POS_Y = 6150;
    const uint EXTENT_X = 6151;
    const uint EXTENT_Y = 6152;
    const uint MAX_X = 6165;        // предельная ширина области у устройства
    const uint MAX_Y = 6166;        // предельная высота области
    const uint INTENT = 6146;       // общее пожелание: цвет, серый или текст
    const uint DATATYPE = 4103;     // как именно кодировать точки
    const uint DEPTH = 4104;        // бит на точку
    const uint PAGES = 3096;        // сколько листов взять из автоподатчика
    const uint HANDLING = 3088;     // откуда брать: стекло или автоподатчик

    // Пожелания к снимку. Именно здесь была ошибка: значение 2
    // означает «оттенки серого», поэтому цветной режим давал ч/б
    const int WANT_COLOR = 0x00000001;
    const int WANT_GRAY = 0x00000002;
    const int WANT_TEXT = 0x00000004;

    // Способ кодирования точек
    const int DATA_THRESHOLD = 0;   // ч/б, одна точка — один бит
    const int DATA_GRAY = 2;
    const int DATA_COLOR = 3;

    const int FEEDER = 0x001;
    const int FLATBED = 0x002;
    const int DUPLEX = 0x004;

    const string JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
    const string BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";

    public sealed class Options
    {
        public string DeviceId = "";
        public string DeviceName = "";   // нужно драйверам TWAIN
        public bool Twain;               // работать через драйвер производителя
        public int Dpi = 300;
        public string Color = "color";   // color | gray | bw
        public bool Feeder;              // брать из автоподатчика
        public bool Duplex;              // обе стороны листа
        public int Limit;                // 0 — пока не кончится бумага
    }

    public sealed class Device
    {
        public string Id = "";
        public string Name = "";
        public bool HasFeeder;
        public bool HasDuplex;
        public bool Twain;               // найден через драйвер производителя
        public bool Manual;              // добавлен человеком вручную
    }

    // Все сканеры компьютера: и те, что видит Windows, и те, что доступны
    // только через драйвер производителя. Второй список закрывает МФУ
    // вроде Kyocera, где производитель не поставляет драйвер для Windows
    public static List<Device> List()
    {
        var found = Sta(ListCore);

        try
        {
            foreach (var t in TwainBridge.List())
            {
                // Одно и то же устройство может попасть в оба списка.
                // Показываем его один раз — тем способом, что уже найден
                bool same = found.Any(d => Same(d.Name, t.Name));
                if (same) continue;

                found.Add(new Device
                {
                    Id = "twain:" + t.Name,
                    Name = t.Name,
                    HasFeeder = t.HasFeeder,
                    HasDuplex = t.HasDuplex,

                    // Помощник ищет двумя путями: драйвером производителя
                    // и службой Windows. Раньше всё помечалось «из
                    // драйвера» — и человек видел пугающее «может быть
                    // недоступен» у аппарата, найденного службой
                    Twain = !t.Wia,
                });
            }
        }
        catch { }

        // Добавленные человеком вручную. Нужны для аппаратов, которые
        // молчат на любой опрос: драйвер знает их только по имени
        try
        {
            foreach (var m in ManualScanners.All())
            {
                if (found.Any(d => Same(d.Name, m.Name))) continue;

                found.Add(new Device
                {
                    Id = (m.Wia ? "manual-wia:" : "manual:") + m.Name,
                    Name = m.Name,
                    HasFeeder = m.Feeder,
                    HasDuplex = m.Duplex,
                    Twain = !m.Wia,
                    Manual = true,
                });
            }
        }
        catch { }

        return found;
    }

    // Убираем из названия служебные слова драйвера: человеку нужен
    // «Kyocera TASKalfa 2020», а не «Kyocera TASKalfa 2020 WIA Driver»
    static string Pretty(string name)
    {
        string s = name.Trim();
        foreach (string tail in new[] { " WIA Driver", " WIA-Driver", " WIA driver", " TWAIN Driver" })
        {
            if (s.EndsWith(tail, StringComparison.OrdinalIgnoreCase))
                s = s.Substring(0, s.Length - tail.Length).Trim();
        }
        return s.Length > 0 ? s : name;
    }

    // Названия у одного устройства слегка расходятся: «Kyocera ECOSYS
    // M2040dn» и «Kyocera ECOSYS M2040dn WIA». Сравниваем по сути
    static bool Same(string a, string b)
    {
        string Clean(string s) => new string(s.ToLowerInvariant()
            .Replace("wia-", "").Replace("wia ", "")
            .Replace("twain", "")
            .Where(char.IsLetterOrDigit).ToArray());

        string x = Clean(a), y = Clean(b);
        if (x.Length == 0 || y.Length == 0) return false;
        if (x == y) return true;

        // Вхождение засчитываем только у достаточно длинных названий.
        // Иначе скупое имя от Windows — «Сканер», «EPSON» — поглощало
        // настоящий аппарат, и тот пропадал из списка
        if (x.Length < 6 || y.Length < 6) return false;
        return x.Contains(y) || y.Contains(x);
    }

    // Почему список пуст. Разбираем причину, чтобы человек знал,
    // что именно чинить, а не гадал над общим «сканер не найден»
    public static string Diagnose() => Sta(DiagnoseCore);

    static string DiagnoseCore()
    {
        if (MakeCom("WIA.DeviceManager") == null)
            return "Служба сканирования Windows (WIA) не отвечает. Откройте «Службы» и запустите «Загрузка изображений (WIA)».";

        // Драйвер TWAIN есть, а WIA нет — типично для Kyocera и части МФУ.
        // Такой сканер видит FineReader, но не видит Windows: снимать его
        // можно только через родное окно производителя
        bool twain = false;
        try
        {
            foreach (string dir in new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "twain_32"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "twain_64"),
            })
            {
                if (Directory.Exists(dir) && Directory.GetDirectories(dir).Length > 0) twain = true;
            }
        }
        catch { }

        if (twain && !TwainBridge.Available())
            return "На компьютере есть драйвер сканера, но не установлен помощник сканирования. Переустановите программу — он ставится вместе с ней.";

        // Помощник есть, но только одной разрядности — значит установлена
        // старая версия программы. Windows держит отдельные списки 32- и
        // 64-разрядных драйверов, и половина аппаратов остаётся невидимой
        if (twain && !(File.Exists(TwainBridge.ExePath()) && File.Exists(TwainBridge.ExePath64())))
            return "Установлена старая версия программы: часть сканеров (в том числе Kyocera и другие современные МФУ) остаётся невидимой. Обновите программу свежим установщиком.";

        if (twain)
            return "Драйвер сканера на компьютере есть, но устройство не отвечает. Проверьте питание и кабель, закройте другие программы сканирования — драйвер работает только с одной. Сетевое устройство должно быть добавлено в программе производителя.";

        return "Ни одного сканера не найдено. Проверьте питание и кабель, установите драйвер производителя, а сетевое устройство добавьте в разделе «Принтеры и сканеры».";
    }

    // Полный отчёт о поиске сканеров: что видит Windows, что видят
    // помощники и какие драйверы установлены. Показывается в окне
    // сканирования, чтобы причину было видно, а не приходилось гадать
    public static string SelfTest()
    {
        var text = new System.Text.StringBuilder();

        text.AppendLine("=== ОТЧЁТ О ПОИСКЕ СКАНЕРОВ ===");

        // Версия в отчёте обязательна: без неё не отличить свежую
        // сборку от старой, и правки приходится проверять на глаз
        string version = "неизвестна";
        try
        {
            version = System.Diagnostics.FileVersionInfo
                .GetVersionInfo(Environment.ProcessPath ?? "").FileVersion ?? "неизвестна";
        }
        catch { }

        text.AppendLine("Версия программы: " + version);
        text.AppendLine("Программа: " + (Environment.Is64BitProcess ? "64" : "32") + " разряда");
        text.AppendLine();

        text.AppendLine("--- Служба Windows (WIA) ---");
        text.AppendLine("Служба «Загрузка изображений»: " + ServiceState());
        try
        {
            var wia = Sta(ListCore);
            if (wia.Count == 0) text.AppendLine("сканеров не найдено");
            foreach (var d in wia) text.AppendLine("  " + d.Name + "   [" + d.Id + "]");

            // Пошаговый разбор: сколько устройств насчитала служба и
            // почему какие-то не попали в список. Без него пустой
            // список приходилось объяснять догадками
            if (Log.Count > 0)
            {
                text.AppendLine("  как искали:");
                foreach (string step in Log) text.AppendLine("    " + step);
            }
        }
        catch (Exception ex) { text.AppendLine("ошибка: " + ex.Message); }
        text.AppendLine();

        // Независимая проверка по реестру Windows. Аппарат здесь есть,
        // а служба его не отдала — значит дело в службе, а не в драйвере
        text.AppendLine("--- Сканеры, записанные в Windows ---");
        try
        {
            var reg = Registered();
            if (reg.Count == 0) text.AppendLine("ничего не записано");
            foreach (string name in reg) text.AppendLine("  " + name);
        }
        catch (Exception ex) { text.AppendLine("ошибка: " + ex.Message); }
        text.AppendLine();

        text.AppendLine("--- Папки драйверов Windows ---");
        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            foreach (string name in new[] { "twain_32", "twain_64" })
            {
                string dir = Path.Combine(win, name);
                if (!Directory.Exists(dir)) { text.AppendLine(name + ": папки нет"); continue; }

                // Имя папки берём с проверкой: для необычного пути оно
                // может не определиться, и такую запись просто пропускаем
                var subs = Directory.GetDirectories(dir)
                    .Select(Path.GetFileName)
                    .Where(n => !string.IsNullOrEmpty(n))
                    .Select(n => n!)
                    .ToList();
                bool dsm = File.Exists(Path.Combine(dir, "TWAINDSM.dll"));
                text.AppendLine(name + ": драйверов " + subs.Count +
                                ", TWAINDSM.dll " + (dsm ? "есть" : "НЕТ"));
                // Показываем СОДЕРЖИМОЕ каждой папки. Посредник ищет
                // драйверы не по папкам, а по файлам .ds внутри них:
                // папка без .ds — это след удалённого или недоустановленного
                // драйвера, и такой аппарат не увидит ни одна программа
                foreach (string sub in subs)
                {
                    string subDir = Path.Combine(dir, sub);
                    string mark;
                    try
                    {
                        var ds = Directory.GetFiles(subDir, "*.ds", SearchOption.AllDirectories);
                        int files = Directory.GetFiles(subDir, "*", SearchOption.AllDirectories).Length;

                        mark = ds.Length > 0
                            ? "файл драйвера есть: " + string.Join(", ",
                                  ds.Select(Path.GetFileName).Where(n => !string.IsNullOrEmpty(n)))
                            : (files == 0
                                ? "ПАПКА ПУСТАЯ — драйвер не установлен"
                                : "файла драйвера (.ds) НЕТ, прочих файлов " + files);
                    }
                    catch (Exception ex) { mark = "не прочитать: " + ex.Message; }

                    text.AppendLine("    " + sub + " — " + mark);

                    // Драйверы сетевых МФУ (Kyocera и подобные) не объявляют
                    // аппарат сами: они показывают только те, что вручную
                    // добавлены в их настройке. Подскажем, где её открыть
                    try
                    {
                        var setup = Directory.GetFiles(subDir, "*.exe", SearchOption.AllDirectories)
                            .Select(Path.GetFileName)
                            .Where(n => !string.IsNullOrEmpty(n))
                            .ToList();
                        if (setup.Count > 0)
                            text.AppendLine("        настройка драйвера: " + string.Join(", ", setup));
                    }
                    catch { }
                }
            }
        }
        catch (Exception ex) { text.AppendLine("ошибка: " + ex.Message); }
        text.AppendLine();

        text.Append(TwainBridge.SelfTest());

        text.AppendLine("--- Итоговый список программы ---");
        var final = new List<Device>();
        try
        {
            final = List();
            if (final.Count == 0) text.AppendLine("пусто");
            foreach (var d in final)
                text.AppendLine("  " + d.Name + (d.Twain ? "   (из драйвера)" : "   (Windows)"));
        }
        catch (Exception ex) { text.AppendLine("ошибка: " + ex.Message); }

        text.AppendLine();
        text.AppendLine("--- ВЫВОД ---");
        text.Append(Verdict(final));

        return text.ToString();
    }

    // Программа настройки драйвера. У сетевых МФУ аппарат добавляется
    // именно в ней, поэтому даём открыть её прямо из окна сканирования,
    // не заставляя искать по меню «Пуск»
    public sealed class DriverSetup
    {
        public string Name = "";   // что показать на кнопке
        public string Path = "";   // что запустить

        // Утилита добавления аппарата в драйвер. Для сетевых МФУ это
        // главная кнопка: без неё аппарат не появится нигде
        public bool Main;

        // Утилита именно для СЕТЕВОГО аппарата. Kyocera по сети
        // заводится только ею
        public bool Network;
    }

    // Ищем такие программы в папках драйверов. Файлов там много,
    // поэтому берём только те, чьё имя говорит о настройке
    public static List<DriverSetup> Setups()
    {
        var found = new List<DriverSetup>();
        // «createsource» — главное слово для сетевых МФУ Kyocera: именно
        // эта утилита добавляет аппарат в драйвер, и без неё драйвер
        // отвечает «не открывается». Раньше кнопки для неё не было,
        // хотя сама утилита лежала в папке рядом
        string[] words =
        {
            "setting", "settings", "setup", "config", "tool", "admin", "manager",
            "createsource", "addscanner", "adddevice", "install", "inst",
        };

        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            foreach (string name in new[] { "twain_32", "twain_64" })
            {
                string dir = Path.Combine(win, name);
                if (!Directory.Exists(dir)) continue;

                foreach (string subDir in Directory.GetDirectories(dir))
                {
                    string? folder = Path.GetFileName(subDir);
                    if (string.IsNullOrEmpty(folder)) continue;

                    string[] exes;
                    try { exes = Directory.GetFiles(subDir, "*.exe", SearchOption.AllDirectories); }
                    catch { continue; }

                    foreach (string exe in exes)
                    {
                        string file = Path.GetFileNameWithoutExtension(exe) ?? "";
                        string low = file.ToLowerInvariant();

                        // Отсеиваем удаление: запустить его по ошибке —
                        // худшее, что может случиться с драйвером
                        if (low.Contains("uninst") || low.Contains("remove")) continue;
                        if (!words.Any(w => low.Contains(w))) continue;
                        if (found.Any(s => string.Equals(s.Path, exe, StringComparison.OrdinalIgnoreCase))) continue;

                        // Утилита добавления аппарата важнее прочих:
                        // без неё сетевой МФУ вообще не появится в списке
                        bool main = low.Contains("createsource")
                                    || low.Contains("addscanner")
                                    || low.Contains("adddevice");

                        // У Kyocera две утилиты: CreateSource для аппарата
                        // по кабелю и CreateSourceN для сетевого («N» —
                        // network). Названия почти одинаковые, поэтому
                        // подписываем их по-человечески
                        bool net = main && low.EndsWith("n");

                        string title = main
                            ? (net ? folder + " — по сети"
                                   : folder + " — по кабелю USB")
                            : folder + " — " + file;

                        found.Add(new DriverSetup
                        {
                            Name = title,
                            Path = exe,
                            Main = main,
                            Network = net,
                        });
                    }
                }
            }
        }
        catch { }

        // Вперёд — утилиты добавления аппарата, среди них первой идёт
        // версия «по кабелю USB»: так подключено большинство аппаратов,
        // да и сетевую видно рядом — перепутать негде
        return found
            .OrderByDescending(x => x.Main)
            .ThenBy(x => x.Network)
            .ToList();
    }

    // Главное в отчёте: разбор простым языком, без чтения таблиц выше.
    // Сопоставляем установленные драйверы с найденными аппаратами —
    // драйвер без единого аппарата означает, что он есть, но пуст
    static string Verdict(List<Device> found)
    {
        var text = new System.Text.StringBuilder();

        // Какие драйверы установлены и рабочие ли они
        var live = new List<string>();   // папка с файлом драйвера
        var dead = new List<string>();   // папка есть, файла драйвера нет

        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            foreach (string name in new[] { "twain_32", "twain_64" })
            {
                string dir = Path.Combine(win, name);
                if (!Directory.Exists(dir)) continue;

                foreach (string subDir in Directory.GetDirectories(dir))
                {
                    string? sub = Path.GetFileName(subDir);
                    if (string.IsNullOrEmpty(sub)) continue;
                    if (live.Contains(sub) || dead.Contains(sub)) continue;

                    try
                    {
                        bool ok = Directory.GetFiles(subDir, "*.ds", SearchOption.AllDirectories).Length > 0;
                        (ok ? live : dead).Add(sub);
                    }
                    catch { }
                }
            }
        }
        catch (Exception ex) { return "не удалось разобраться: " + ex.Message + Environment.NewLine; }

        if (live.Count == 0 && dead.Count == 0)
        {
            text.AppendLine("Драйверов сканирования на компьютере нет.");
            text.AppendLine("Установите драйвер производителя для вашего аппарата.");
            return text.ToString();
        }

        // Сравниваем ЧИСЛАМИ, а не по названиям: папки драйверов
        // называются кодами вроде escndv или KMTWAIN, и надёжно
        // связать такой код с названием аппарата нельзя.
        // А вот счёт говорит сам за себя: рабочих драйверов больше,
        // чем найденных аппаратов, — значит кто-то из них промолчал
        int silent = live.Count - found.Count;

        text.AppendLine("Найдено аппаратов: " + found.Count);
        text.AppendLine("Рабочих драйверов: " + live.Count +
                        (dead.Count > 0 ? ", недоустановленных: " + dead.Count : ""));
        text.AppendLine();

        if (dead.Count > 0)
        {
            text.AppendLine("НЕДОУСТАНОВЛЕН: " + string.Join(", ", dead));
            text.AppendLine("  Папка драйвера есть, а самого драйвера в ней нет.");
            text.AppendLine("  Обычно так остаётся после удаления или прерванной установки.");
            text.AppendLine("  Что делать: установить драйвер производителя заново.");
            text.AppendLine();
        }

        if (silent > 0)
        {
            text.AppendLine("ПАПОК ДРАЙВЕРОВ БОЛЬШЕ, ЧЕМ НАЙДЕННЫХ АППАРАТОВ");
            text.AppendLine("  Папок драйверов " + live.Count +
                            ", аппаратов получено " + found.Count + ".");
            text.AppendLine("  Папки: " + string.Join(", ", live));
            text.AppendLine();
            text.AppendLine("  Само по себе это НЕ означает поломку: у одного");
            text.AppendLine("  аппарата бывает несколько папок, а часть аппаратов");
            text.AppendLine("  приходит не отсюда, а от службы Windows.");
            text.AppendLine("  Смотрите список выше — если нужный аппарат в нём есть,");
            text.AppendLine("  всё в порядке.");
            text.AppendLine();
            text.AppendLine("  Если нужного аппарата в списке НЕТ, причины обычно две.");
            text.AppendLine();
            text.AppendLine("  1. Аппарат не добавлен в настройку драйвера.");
            text.AppendLine("     Драйверы сетевых МФУ (Kyocera, Ricoh, Sharp) не объявляют");
            text.AppendLine("     аппарат сами — показывают только добавленные вручную.");
            text.AppendLine("     Проверить просто: если аппарат виден в другой программе");
            text.AppendLine("     сканирования, значит он добавлен и дело не в этом.");
            text.AppendLine("     Открыть настройку можно кнопкой в окне сканирования.");
            text.AppendLine();

            // Точный путь для Kyocera: у неё аппарат добавляется
            // отдельной утилитой, и без неё драйвер отвечает
            // «не открывается» — ровно то, что видно в отчёте выше
            foreach (var setup in Setups().Where(x => x.Main))
                text.AppendLine("     Нужная утилита: " + setup.Path);
            text.AppendLine();
            text.AppendLine("  2. Аппарат выключен или отсоединён.");
            text.AppendLine("     Проверьте питание и кабель, затем обновите список.");
            text.AppendLine();
        }

        if (dead.Count == 0 && silent <= 0)
        {
            text.AppendLine(found.Count > 0
                ? "Всё в порядке: аппаратов найдено не меньше, чем установлено драйверов."
                : "Драйверы на месте, но аппаратов не отдали. Проверьте питание и кабель.");
        }

        return text.ToString();
    }

    // Пошаговый рассказ о последнем поиске через службу Windows.
    // Раньше все ошибки гасились молча, и пустой список нечем было
    // объяснить — оставалось гадать
    public static readonly List<string> Log = new();

    static List<Device> ListCore()
    {
        var found = new List<Device>();
        dynamic? mgr = null;
        Log.Clear();

        try
        {
            mgr = MakeCom("WIA.DeviceManager");
            if (mgr == null)
            {
                Log.Add("служба не создалась: WIA.DeviceManager недоступен");
                return found;
            }

            // Устройства перебираем по номеру, а не единым списком.
            // Перебор списком обрывается целиком, стоит одному капризному
            // драйверу ответить с ошибкой, — и вместе с ним пропадали
            // исправные сканеры, которые стояли в списке дальше
            int count = -1;
            try { count = (int)mgr.DeviceInfos.Count; }
            catch (Exception ex) { Log.Add("не сосчитать устройства: " + Short(ex)); }

            Log.Add("служба насчитала устройств: " + (count < 0 ? "не удалось" : count.ToString()));

            for (int i = 1; i <= count; i++)
            {
                dynamic? info = null;
                try
                {
                    info = mgr.DeviceInfos[i];
                    var dev = ReadDevice(info, i);
                    if (dev != null) found.Add(dev);
                }
                catch (Exception ex) { Log.Add($"   № {i}: не прочитать — " + Short(ex)); }
                finally { Release(info); }
            }

            // Номера не подошли — пробуем обычным перебором.
            // Лучше неполный список, чем пустой
            if (found.Count == 0 && count != 0)
            {
                Log.Add("по номерам ничего не вышло, пробуем обычным перебором");
                try
                {
                    int k = 0;
                    foreach (dynamic info in mgr.DeviceInfos)
                    {
                        k++;
                        try
                        {
                            var dev = ReadDevice(info, k);
                            if (dev != null) found.Add(dev);
                        }
                        catch (Exception ex) { Log.Add($"   № {k}: не прочитать — " + Short(ex)); }
                    }
                }
                catch (Exception ex) { Log.Add("перебор оборвался: " + Short(ex)); }
            }

            Log.Add("итого сканеров: " + found.Count);
        }
        catch (Exception ex) { Log.Add("сбой поиска: " + Short(ex)); }
        finally { Release(mgr); }

        return found;
    }

    // Состояние службы «Загрузка изображений (WIA)». Она может быть
    // остановлена или отключена — тогда посредник создаётся как ни в чём
    // не бывало, а список аппаратов приходит пустым. Без этой проверки
    // пустой список выглядел загадкой
    public static string ServiceState()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine
                .OpenSubKey(@"SYSTEM\CurrentControlSet\Services\stisvc");

            if (key == null) return "нет в системе";

            int start = Convert.ToInt32(key.GetValue("Start") ?? 4);
            return start switch
            {
                2 => "запуск автоматический",
                3 => "запуск вручную",
                4 => "ОТКЛЮЧЕНА — включите её, иначе сканеры не видны",
                _ => "режим запуска " + start,
            };
        }
        catch (Exception ex) { return "не прочитать: " + Short(ex); }
    }

    // Сканеры, зарегистрированные в Windows. Независимая проверка:
    // аппарат здесь есть, а служба его не отдала — значит дело в службе
    public static List<string> Registered()
    {
        var list = new List<string>();

        try
        {
            using var root = Microsoft.Win32.Registry.LocalMachine
                .OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{6bdd1fc6-810f-11d0-bec7-08002be2092f}");

            if (root == null) return list;

            foreach (string sub in root.GetSubKeyNames())
            {
                // Внутри лежат и служебные разделы вроде Properties
                if (!int.TryParse(sub, out _)) continue;

                try
                {
                    using var item = root.OpenSubKey(sub);
                    string? name = item?.GetValue("FriendlyName") as string
                                ?? item?.GetValue("DriverDesc") as string;

                    if (!string.IsNullOrWhiteSpace(name)) list.Add(Pretty(name!));
                }
                catch { }
            }
        }
        catch (Exception ex) { list.Add("не прочитать: " + Short(ex)); }

        return list;
    }

    // Короткая суть ошибки: длинные технические простыни в отчёте
    // только мешают читать
    static string Short(Exception ex)
    {
        string m = ex.Message.Trim();
        int stop = m.IndexOf('\n');
        if (stop > 0) m = m.Substring(0, stop).Trim();
        if (m.Length > 160) m = m.Substring(0, 160) + "...";
        return m.Length > 0 ? m : ex.GetType().Name;
    }

    // Сведения об одном устройстве. Возвращает null только для заведомо
    // чужого — камер и видеоустройств
    static Device? ReadDevice(dynamic info, int number)
    {
        // Тип устройства читаем мягко. Часть драйверов (в том числе
        // у сетевых МФУ) его не сообщает или отдаёт нестандартное
        // значение — раньше такой сканер молча пропадал из списка.
        // Отсекаем только заведомо чужое: камеры и видеоустройства
        int type = -1;
        try { type = (int)info.Type; }
        catch (Exception ex) { Log.Add($"   № {number}: тип не сообщён — " + Short(ex)); }

        if (type == 2 || type == 3)
        {
            Log.Add($"   № {number}: пропущен, это " + (type == 2 ? "камера" : "видеоустройство"));
            return null;
        }

        string id = "";
        try { id = (string)info.DeviceID; }
        catch (Exception ex) { Log.Add($"   № {number}: нет кода устройства — " + Short(ex)); }

        string name = "";
        try { name = Prop(info.Properties, "Name") ?? ""; }
        catch (Exception ex) { Log.Add($"   № {number}: нет названия — " + Short(ex)); }

        // Без кода устройства снимать нечего, а вот без имени — можно:
        // подставим понятную замену
        if (string.IsNullOrWhiteSpace(id))
        {
            Log.Add($"   № {number}: пропущен, устройство без кода");
            return null;
        }
        if (string.IsNullOrWhiteSpace(name)) name = "Сканер";

        Log.Add($"   № {number}: {Pretty(name)}");

        int caps = 0;
        try { caps = Convert.ToInt32(Prop(info.Properties, "Document Handling Capabilities") ?? "0"); }
        catch { }

        return new Device
        {
            Id = id,
            Name = Pretty(name),
            HasFeeder = (caps & FEEDER) != 0,
            HasDuplex = (caps & DUPLEX) != 0,
        };
    }

    // Служба сканирования работает только в однопоточном режиме COM (STA).
    // Из обычного фонового потока часть драйверов просто не отвечает и
    // устройство «исчезает» — поэтому опрос уводим на собственный STA-поток
    static T Sta<T>(Func<T> work)
    {
        T result = default!;
        Exception? error = null;

        var thread = new Thread(() =>
        {
            try { result = work(); }
            catch (Exception ex) { error = ex; }
        });

        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join();

        if (error != null) throw error;
        return result;
    }

    // Какое качество поддерживает устройство. Спрашиваем только у
    // сканеров производителя (TWAIN) — у остальных Windows такого
    // списка не даёт. Пустой ответ значит «показывай обычный набор»
    public static List<int> Resolutions(string deviceId)
    {
        if (deviceId.StartsWith("twain:"))
            return TwainBridge.Resolutions(deviceId.Substring(6));

        // Добавленный вручную аппарат спрашиваем по имени
        if (deviceId.StartsWith("manual:"))
            return TwainBridge.Resolutions(deviceId.Substring(7));

        return new List<int>();
    }

    // Родное окно сканера от производителя. Нужно капризным устройствам,
    // у которых свои настройки: подсветка, обрезка полей, очистка фона.
    // Снимки оттуда попадают в программу как обычные страницы
    public static List<string> ShowDriverUi(string deviceId, string dir)
    {
        // У устройств производителя своё окно настроек — открываем его
        if (deviceId.StartsWith("twain:"))
        {
            var opt = new Options { DeviceName = deviceId.Substring(6) };
            return TwainBridge.Scan(opt, dir, true, (_, _) => { }, CancellationToken.None);
        }

        if (deviceId.StartsWith("manual:"))
        {
            var opt = new Options { DeviceName = deviceId.Substring(7) };
            return TwainBridge.Scan(opt, dir, true, (_, _) => { }, CancellationToken.None);
        }

        if (deviceId.StartsWith("manual-wia:"))
            return Sta(() => ShowDriverUiCore(deviceId.Substring(11), dir));

        return Sta(() => ShowDriverUiCore(deviceId, dir));
    }

    static List<string> ShowDriverUiCore(string deviceId, string dir)
    {
        var files = new List<string>();
        Directory.CreateDirectory(dir);

        dynamic? dialog = null;
        dynamic? device = null;
        dynamic? mgr = null;

        try
        {
            dialog = MakeCom("WIA.CommonDialog")
                ?? throw new InvalidOperationException(
                    "Служба сканирования Windows недоступна. Проверьте, что служба «Загрузка изображений (WIA)» запущена.");

            // Подключаемся к выбранному устройству, чтобы Windows не спрашивала
            // о нём повторно — пользователь уже указал сканер в нашем окне
            if (!string.IsNullOrEmpty(deviceId))
            {
                try
                {
                    mgr = MakeCom("WIA.DeviceManager");
                    if (mgr != null)
                    {
                        foreach (dynamic d in mgr.DeviceInfos)
                        {
                            if ((string)d.DeviceID != deviceId) continue;
                            device = d.Connect();
                            break;
                        }
                    }
                }
                catch { }
            }

            try
            {
                if (device != null)
                {
                    // Окно настроек драйвера для выбранного сканера:
                    // пользователь выставляет всё родными средствами,
                    // после чего снимок забираем обычным способом
                    dynamic item = device.Items[1];
                    bool ok = dialog.ShowItemProperties(item, 0);
                    if (!ok) return files;

                    dynamic? shot = null;
                    try
                    {
                        shot = item.Transfer(JPEG);
                    }
                    catch (COMException ex) when (!Empty(ex))
                    {
                        shot = item.Transfer(BMP);
                    }

                    Save(shot, dir, files, "jpg");
                    return files;
                }

                // Сканер не выбран — показываем полное окно Windows вместе
                // с выбором устройства. Тип устройства НЕ ограничиваем (0):
                // с фильтром «только сканер» Windows отвечает «не доступно
                // ни одно устройство выбранного типа» тем МФУ, которые
                // не сообщают о себе стандартный тип
                dynamic? image = null;
                try
                {
                    image = dialog.ShowAcquireImage(0, 0, 0x00040000, JPEG, false, true, false);
                }
                catch (COMException ex) when (!Cancelled(ex))
                {
                    // Запасной путь: сперва выбор устройства, потом съёмка.
                    // Часть драйверов работает только такой связкой
                    dynamic? picked = dialog.ShowSelectDevice(0, true, false);
                    if (picked == null) return files;

                    try
                    {
                        dynamic pickedItem = picked.Items[1];
                        if (!dialog.ShowItemProperties(pickedItem, 0)) return files;
                        image = pickedItem.Transfer(JPEG);
                    }
                    finally { Release(picked); }
                }

                Save(image, dir, files, "jpg");
                return files;
            }
            catch (COMException ex)
            {
                // Пользователь закрыл окно, ничего не отсканировав
                if (Cancelled(ex) || Empty(ex)) return files;
                throw;
            }
        }
        finally
        {
            Release(device);
            Release(mgr);
            Release(dialog);
        }
    }

    static void Save(dynamic? image, string dir, List<string> files, string ext)
    {
        if (image == null) return;

        string path = Path.Combine(dir, $"scan_{files.Count + 1:D3}.{ext}");
        try { if (File.Exists(path)) File.Delete(path); } catch { }

        image.SaveFile(path);
        Release(image);
        files.Add(path);
    }

    // Пользователь закрыл окно драйвера, ничего не отсканировав
    static bool Cancelled(COMException ex)
    {
        unchecked
        {
            int code = ex.ErrorCode;
            return code == (int)0x80210064   // отменено пользователем
                || code == (int)0x800704C7;  // операция прервана
        }
    }

    // Снимаем страницы и складываем их картинками в указанную папку.
    // onPage вызывается после каждого листа — интерфейс сразу показывает,
    // сколько уже отсканировано, не дожидаясь всей пачки
    public static List<string> Scan(Options opt, string dir, Action<int, string> onPage, CancellationToken token)
    {
        // Добавленный вручную аппарат снимаем по имени. Через службу
        // Windows или через драйвер — как указал человек при добавлении
        if (opt.DeviceId.StartsWith("manual-wia:"))
        {
            // Ищем по имени: системного кода у такого аппарата нет,
            // и оставленный код помешал бы совпадению
            opt.DeviceName = opt.DeviceId.Substring(11);
            opt.DeviceId = "";
            return Sta(() => ScanCore(opt, dir, onPage, token));
        }

        if (opt.DeviceId.StartsWith("manual:"))
        {
            opt.Twain = true;
            opt.DeviceName = opt.DeviceId.Substring(7);
            return TwainBridge.Scan(opt, dir, false, onPage, token);
        }

        // Устройство от производителя снимаем через помощника:
        // Windows о таком сканере не знает и помочь не может
        if (opt.Twain || opt.DeviceId.StartsWith("twain:"))
            return TwainBridge.Scan(opt, dir, false, onPage, token);

        // Обычный путь — служба Windows.
        //
        // ГЛАВНОЕ. Раньше на этом всё и заканчивалось. Если аппарат
        // попал в список от службы Windows, но снимать ею отказывается
        // (ровно случай Kyocera: в списке WIA он есть, а изображение
        // не отдаёт), человек получал «не передал ни одной страницы»
        // — и ни одна из наших доработок драйвера даже не запускалась.
        //
        // Теперь при неудаче пробуем второй путь: тот самый драйвер
        // производителя, которым снимает FineReader. Название аппарата
        // у нас есть, помощник найдёт его по сути имени
        List<string> files;

        try
        {
            files = Sta(() => ScanCore(opt, dir, onPage, token));
            if (files.Count > 0) return files;

            LastWhy = "Служба Windows не отдала ни одной страницы.";
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            LastWhy = "Служба Windows: " + ex.Message;
            files = new List<string>();
        }

        token.ThrowIfCancellationRequested();

        // Второй заход — драйвером производителя
        try
        {
            var viaDriver = new Options
            {
                DeviceId = "",
                DeviceName = string.IsNullOrWhiteSpace(opt.DeviceName) ? DeviceTitle(opt.DeviceId) : opt.DeviceName,
                Dpi = opt.Dpi,
                Color = opt.Color,
                Feeder = opt.Feeder,
                Duplex = opt.Duplex,
                Limit = opt.Limit,
                Twain = true,
            };

            var got = TwainBridge.Scan(viaDriver, dir, false, onPage, token);
            if (got.Count > 0) return got;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            LastWhy += "\nДрайвер производителя: " + ex.Message;
        }

        throw new InvalidOperationException(
            "Сканер не передал ни одной страницы.\n\nЧто происходило:\n" + LastWhy);
    }

    // Почему не вышло — показываем человеку целиком, а не одной строкой
    public static string LastWhy = "";

    // Название аппарата по его системному коду. Спрашиваем только
    // службу Windows — полный опрос здесь был бы лишней задержкой
    static string DeviceTitle(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "";

        try
        {
            foreach (var d in Sta(ListCore))
                if (string.Equals(d.Id, id, StringComparison.OrdinalIgnoreCase))
                    return d.Name;
        }
        catch { }

        return "";
    }

    static List<string> ScanCore(Options opt, string dir, Action<int, string> onPage, CancellationToken token)
    {
        var files = new List<string>();
        Directory.CreateDirectory(dir);

        dynamic? mgr = null;
        dynamic? device = null;

        try
        {
            mgr = MakeCom("WIA.DeviceManager")
                ?? throw new InvalidOperationException(
                    "Служба сканирования Windows недоступна. Проверьте, что служба «Загрузка изображений (WIA)» запущена.");

            dynamic? info = null;
            foreach (dynamic d in mgr.DeviceInfos)
            {
                int type = -1;
                try { type = (int)d.Type; } catch { }
                if (type == 2 || type == 3) continue;   // камера и видео - не сканеры

                if (string.IsNullOrEmpty(opt.DeviceId) || (string)d.DeviceID == opt.DeviceId)
                {
                    info = d;
                    break;
                }

                // Аппарат, добавленный вручную, известен только по имени —
                // системного кода у него нет. Сверяем название
                if (!string.IsNullOrEmpty(opt.DeviceName))
                {
                    string title = "";
                    try { title = (string)d.Properties["Name"].get_Value(); } catch { }

                    if (Same(title, opt.DeviceName))
                    {
                        info = d;
                        break;
                    }
                }
            }

            if (info == null)
                throw new InvalidOperationException("Сканер не найден. Проверьте, что он включён и подключён к компьютеру.");

            device = info.Connect();
            dynamic item = device.Items[1];

            Setup(device, item, opt);

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 200;

            while (made < cap)
            {
                token.ThrowIfCancellationRequested();

                dynamic? image = null;
                string ext = "jpg";

                try
                {
                    // JPEG умеют не все драйверы, а чёрно-белый снимок
                    // в него порой вовсе не отдаётся — тогда берём BMP
                    try
                    {
                        image = item.Transfer(JPEG);
                    }
                    catch (COMException ex) when (!Empty(ex))
                    {
                        image = item.Transfer(BMP);
                        ext = "bmp";
                    }
                }
                catch (COMException ex)
                {
                    // Бумага в автоподатчике кончилась — это не ошибка,
                    // а обычное завершение пачки
                    if (Empty(ex) && made > 0) break;
                    if (Empty(ex))
                        throw new InvalidOperationException(
                            opt.Feeder
                                ? "В автоподатчике нет бумаги. Положите листы и повторите."
                                : "Сканер не отдал изображение. Проверьте, что документ лежит на стекле.");
                    throw;
                }

                made++;
                string path = Path.Combine(dir, $"scan_{made:D3}.{ext}");
                try { if (File.Exists(path)) File.Delete(path); } catch { }

                image.SaveFile(path);
                Release(image);

                files.Add(path);
                onPage(made, path);

                // Со стекла берём ровно один лист: следующий пользователь
                // положит сам. Из автоподатчика идём до конца пачки
                if (!opt.Feeder) break;
                if (opt.Limit > 0 && made >= opt.Limit) break;
            }

            return files;
        }
        finally
        {
            Release(device);
            Release(mgr);
        }
    }

    // Настройки съёмки. Некоторые сканеры не понимают часть свойств —
    // такие пропускаем молча, чтобы не срывать всю работу
    static void Setup(dynamic device, dynamic item, Options opt)
    {
        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));

        // Сначала пожелание к снимку, потом всё остальное: драйвер в ответ
        // сам подбирает глубину цвета, и порядок здесь важен. Если задать
        // разрешение раньше, часть сканеров сбрасывает его обратно
        int intent = opt.Color switch
        {
            "bw" => WANT_TEXT,
            "gray" => WANT_GRAY,
            _ => WANT_COLOR,
        };
        Set(item.Properties, INTENT, intent);

        // Прямо указываем способ кодирования и глубину: на одном лишь
        // пожелании часть драйверов продолжает отдавать чёрно-белое
        switch (opt.Color)
        {
            case "bw":
                Set(item.Properties, DATATYPE, DATA_THRESHOLD);
                Set(item.Properties, DEPTH, 1);
                break;
            case "gray":
                Set(item.Properties, DATATYPE, DATA_GRAY);
                Set(item.Properties, DEPTH, 8);
                break;
            default:
                Set(item.Properties, DATATYPE, DATA_COLOR);
                Set(item.Properties, DEPTH, 24);
                break;
        }

        Set(item.Properties, DPI_X, dpi);
        Set(item.Properties, DPI_Y, dpi);

        // Снимаем от левого верхнего угла
        Set(item.Properties, POS_X, 0);
        Set(item.Properties, POS_Y, 0);

        // Область съёмки — лист A4, но не больше, чем умеет устройство:
        // запрос сверх предела драйвер отклоняет вместе со всей настройкой
        int wantW = (int)(8.27 * dpi);
        int wantH = (int)(11.69 * dpi);
        int maxW = Num(item.Properties, MAX_X);
        int maxH = Num(item.Properties, MAX_Y);

        Set(item.Properties, EXTENT_X, maxW > 0 ? Math.Min(wantW, maxW) : wantW);
        Set(item.Properties, EXTENT_Y, maxH > 0 ? Math.Min(wantH, maxH) : wantH);

        if (opt.Feeder)
        {
            int handling = FEEDER | (opt.Duplex ? DUPLEX : 0);
            Set(device.Properties, HANDLING, handling);
            Set(device.Properties, PAGES, opt.Limit > 0 ? opt.Limit : 0);
        }
        else
        {
            Set(device.Properties, HANDLING, FLATBED);
        }
    }

    static void Set(dynamic props, uint id, int value)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((uint)p.PropertyID != id) continue;
                p.Value = value;
                return;
            }
        }
        catch { }
    }

    // Числовое свойство устройства. Ноль означает «драйвер не сообщил»
    static int Num(dynamic props, uint id)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((uint)p.PropertyID != id) continue;
                return Convert.ToInt32(p.Value);
            }
        }
        catch { }
        return 0;
    }

    static string? Prop(dynamic props, string name)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((string)p.Name == name) return Convert.ToString(p.Value);
            }
        }
        catch { }
        return null;
    }

    // Признак «бумага кончилась» в ответе службы сканирования
    static bool Empty(COMException ex)
    {
        unchecked
        {
            int code = ex.ErrorCode;
            return code == (int)0x80210003    // нет бумаги
                || code == (int)0x80210002    // занят
                || code == (int)0x8021000D;   // подача завершена
        }
    }

    static dynamic? MakeCom(string progId)
    {
        try
        {
            Type? t = Type.GetTypeFromProgID(progId);
            return t == null ? null : Activator.CreateInstance(t);
        }
        catch { return null; }
    }

    static void Release(object? com)
    {
        try { if (com != null && Marshal.IsComObject(com)) Marshal.ReleaseComObject(com); }
        catch { }
    }
}