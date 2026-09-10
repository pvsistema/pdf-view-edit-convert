using System.Diagnostics;
using System.Text.Json;

namespace PvsPdfApp;

// Связь с помощниками сканирования. Они умеют работать с драйверами
// производителей — теми же, что использует FineReader. Благодаря этому
// программа видит сканеры, о которых Windows не знает.
//
// Помощников ДВА, и это не запас: Windows держит два несвязанных списка
// драйверов — 32-разрядные в twain_32, 64-разрядные в twain_64. Программа
// одной разрядности видит только «свой» список. Старые аппараты (Epson,
// Canon, HP) отзываются 32-разрядному помощнику, новые МФУ вроде Kyocera —
// 64-разрядному. Спрашиваем обоих и складываем ответы.
internal static class TwainBridge
{
    // Настройки, которые сканер не принял при последней съёмке.
    // Например, дешёвая модель может не уметь 1200 точек
    public static readonly List<string> Ignored = new();

    public sealed class Device
    {
        public string Name = "";
        public bool HasFeeder;
        public bool HasDuplex;

        // Аппарат известен службе Windows, а не драйверу производителя.
        // Снимать его надо иначе, поэтому признак запоминаем
        public bool Wia;
    }

    // Помощники лежат рядом с программой
    public static string ExePath() => Path.Combine(AppContext.BaseDirectory, "PVSPDF-twain.exe");
    public static string ExePath64() => Path.Combine(AppContext.BaseDirectory, "PVSPDF-twain64.exe");

    // Хоть один помощник на месте — работать можно
    public static bool Available() => File.Exists(ExePath()) || File.Exists(ExePath64());

    // Оба помощника, какие удалось найти. Порядок важен: 64-разрядный
    // спрашиваем первым — современные аппараты чаще отзываются ему
    static List<string> Helpers()
    {
        var list = new List<string>();
        if (File.Exists(ExePath64())) list.Add(ExePath64());
        if (File.Exists(ExePath())) list.Add(ExePath());
        return list;
    }

    // Каким помощником снимать это устройство. Запоминаем при опросе:
    // аппарат отзывается только «своей» разрядности
    static readonly Dictionary<string, string> _owner = new(StringComparer.OrdinalIgnoreCase);

    // Каким способом аппарат нашёлся: службой Windows или драйвером
    static readonly Dictionary<string, bool> _viaWia = new(StringComparer.OrdinalIgnoreCase);

    static string HelperFor(string device)
    {
        if (!string.IsNullOrWhiteSpace(device) &&
            _owner.TryGetValue(device, out string? exe) &&
            File.Exists(exe)) return exe;

        var all = Helpers();
        return all.Count > 0 ? all[0] : ExePath();
    }

    static Process Start(string exe, string args, bool visible = false)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            Arguments = args,
            UseShellExecute = false,

            // Окно выбора сканера рисует сам драйвер — прятать помощника
            // в этом случае нельзя, иначе человек ничего не увидит
            CreateNoWindow = !visible,
            RedirectStandardOutput = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };

        return Process.Start(psi) ?? throw new InvalidOperationException(
            "Не удалось запустить помощник сканирования.");
    }

    // Окно выбора сканера от самого драйвера.
    //
    // Зачем. Аппарат может молчать при обычном опросе, но в собственном
    // окне драйвера он есть — человек выбирает его мышью, и нам не
    // приходится просить набирать название вручную
    // Рассказ о последнем выборе — показываем человеку, если аппарат
    // выбрать не удалось
    public static readonly List<string> ChooseLog = new();

    public static Device? Choose()
    {
        ChooseLog.Clear();
        // 32-разрядный помощник идёт ПЕРВЫМ: драйверы сканеров живут
        // в папке twain_32, а у 64-разрядного их нет вовсе — он открыл
        // бы пустое окно, человек закрыл бы его, и на этом всё
        var order = Helpers();
        order.Reverse();

        foreach (string exe in order)
        {
            try
            {
                using var p = Start(exe, "choose", visible: true);

                string output = p.StandardOutput.ReadToEnd();

                // Человек может задуматься над выбором — ждём долго
                if (!p.WaitForExit(180000))
                {
                    try { p.Kill(true); } catch { }
                    continue;
                }

                foreach (string line in output.Split('\n'))
                {
                    string s = line.Trim();
                    if (!s.StartsWith("{")) continue;

                    using var doc = JsonDocument.Parse(s);
                    var root = doc.RootElement;

                    // Рассказ помощника о шагах — пригодится, если
                    // окно так и не показалось
                    if (root.TryGetProperty("steps", out var st) &&
                        st.ValueKind == JsonValueKind.Array)
                    {
                        ChooseLog.Add(Path.GetFileName(exe) + ":");
                        foreach (var step in st.EnumerateArray())
                            ChooseLog.Add("   " + (step.GetString() ?? ""));
                    }

                    // Окно закрыли, ничего не выбрав — второго помощника
                    // не спрашиваем, решение уже принято
                    if (root.TryGetProperty("cancelled", out var c) && c.GetBoolean())
                        return null;

                    if (!root.TryGetProperty("name", out var n)) continue;

                    string name = n.GetString() ?? "";
                    if (string.IsNullOrWhiteSpace(name)) continue;

                    _owner[name] = exe;
                    _viaWia[name] = false;

                    return new Device
                    {
                        Name = name,
                        HasFeeder = root.TryGetProperty("feeder", out var f) && f.GetBoolean(),
                        HasDuplex = root.TryGetProperty("duplex", out var d) && d.GetBoolean(),
                    };
                }
            }
            catch { }
        }

        return null;
    }

    // Какое качество поддерживает аппарат. Пустой список означает
    // «выяснить не удалось» — тогда показываем обычный набор значений
    public static List<int> Resolutions(string device)
    {
        var found = new List<int>();
        if (!Available() || string.IsNullOrWhiteSpace(device)) return found;

        try
        {
            using var p = Start(HelperFor(device), $"caps --device {Quote(device)}");
            string output = p.StandardOutput.ReadToEnd();
            if (!p.WaitForExit(25000))
            {
                try { p.Kill(true); } catch { }
                return found;
            }

            foreach (string line in output.Split('\n'))
            {
                string s = line.Trim();
                if (!s.StartsWith("{")) continue;

                using var doc = JsonDocument.Parse(s);
                if (!doc.RootElement.TryGetProperty("dpi", out var arr)) continue;
                if (arr.ValueKind != JsonValueKind.Array) continue;

                foreach (var v in arr.EnumerateArray())
                    if (v.TryGetInt32(out int n)) found.Add(n);
            }
        }
        catch { }

        return found;
    }

    // Список сканеров, известных драйверам TWAIN. Спрашиваем обоих
    // помощников: у 32- и 64-разрядных драйверов свои, несвязанные списки
    public static List<Device> List()
    {
        var found = new List<Device>();

        foreach (string exe in Helpers())
        {
            // Один помощник может не отозваться — это не повод терять
            // сканеры, известные второму
            try
            {
                foreach (var dev in ListOne(exe))
                {
                    // Сетевой МФУ иногда отвечает обоим — показываем один раз
                    if (found.Any(d => string.Equals(d.Name, dev.Name, StringComparison.OrdinalIgnoreCase)))
                        continue;

                    _owner[dev.Name] = exe;
                    _viaWia[dev.Name] = dev.Wia;
                    found.Add(dev);
                }
            }
            catch { }
        }

        return found;
    }

    // Отчёт о самопроверке обоих помощников. Нужен, когда сканер
    // не находится: показывает, на каком шаге обрывается цепочка
    public static string SelfTest()
    {
        var text = new System.Text.StringBuilder();

        foreach (string exe in new[] { ExePath64(), ExePath() })
        {
            string title = exe == ExePath64() ? "64-разрядный помощник" : "32-разрядный помощник";
            text.AppendLine("--- " + title + " ---");

            if (!File.Exists(exe))
            {
                text.AppendLine("НЕ УСТАНОВЛЕН: " + exe);
                text.AppendLine();
                continue;
            }

            try
            {
                using var p = Start(exe, "selftest");
                string output = p.StandardOutput.ReadToEnd();
                if (!p.WaitForExit(25000))
                {
                    try { p.Kill(true); } catch { }
                    text.AppendLine("не ответил за 25 секунд");
                }
                else
                {
                    text.AppendLine(Readable(output.Trim()));
                }
            }
            catch (Exception ex)
            {
                text.AppendLine("не запустился: " + ex.Message);
            }

            text.AppendLine();
        }

        return text.ToString();
    }

    // Помощник отвечает служебной строкой. Показывать её человеку как
    // есть нельзя: русские буквы в ней закодированы, всё в одну строку.
    // Разбираем и раскладываем понятными строчками
    static string Readable(string output)
    {
        var text = new System.Text.StringBuilder();

        foreach (string line in output.Split('\n'))
        {
            string s = line.Trim();
            if (!s.StartsWith("{")) { if (s.Length > 0) text.AppendLine(s); continue; }

            try
            {
                using var doc = JsonDocument.Parse(s);
                var root = doc.RootElement;

                if (!root.TryGetProperty("report", out var report))
                {
                    text.AppendLine(s);
                    continue;
                }

                foreach (var field in report.EnumerateObject())
                    Print(text, Title(field.Name), field.Value, "  ");
            }
            catch { text.AppendLine(s); }
        }

        return text.ToString().TrimEnd();
    }

    // Человеческие названия для полей отчёта
    static string Title(string name) => name switch
    {
        "version" => "версия помощника",
        "bits" => "разрядность",
        "pack" => "укладка полей",
        "dsmSearched" => "где искали посредника",
        "dsmFound" => "посредник найден",
        "dsmNew" => "посредник современный",
        "dsmReady" => "посредник готов",
        "driverFolders" => "папки драйверов",
        "scanners" => "сканеры от драйверов",
        "scannersError" => "ошибка опроса драйверов",
        "skipped" => "драйверов не отозвалось",
        "wiaReady" => "служба Windows отвечает",
        "wiaService" => "служба «Загрузка изображений»",
        "wiaScanners" => "сканеры от службы Windows",
        "wiaRegistered" => "сканеры, записанные в Windows",
        "wiaWalk" => "как искали через службу",
        "directScanners" => "сканеры от службы напрямую",
        "directWalk" => "как искали напрямую",
        "dsScanners" => "сканеры от файлов драйверов",
        "dsWalk" => "как опрашивали файлы драйверов",
        "dsError" => "ошибка опроса файлов драйверов",
        "wiaError" => "ошибка службы Windows",
        "walk" => "обход драйверов",
        _ => name,
    };

    static void Print(System.Text.StringBuilder text, string title, JsonElement value, string pad)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            var items = value.EnumerateArray().ToList();
            if (items.Count == 0) { text.AppendLine(pad + title + ": пусто"); return; }

            text.AppendLine(pad + title + ":");
            foreach (var it in items) text.AppendLine(pad + "   " + Plain(it));
            return;
        }

        text.AppendLine(pad + title + ": " + Plain(value));
    }

    static string Plain(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString() ?? "",
        JsonValueKind.True => "да",
        JsonValueKind.False => "нет",
        _ => v.ToString(),
    };

    static List<Device> ListOne(string exe)
    {
        var found = new List<Device>();

        using var p = Start(exe, "list");

        // Опрос драйверов бывает небыстрым, но вечно ждать нельзя
        string output = p.StandardOutput.ReadToEnd();
        if (!p.WaitForExit(25000))
        {
            try { p.Kill(true); } catch { }
            return found;
        }

        foreach (string line in output.Split('\n'))
        {
            string s = line.Trim();
            if (!s.StartsWith("{")) continue;

            try
            {
                using var doc = JsonDocument.Parse(s);
                var root = doc.RootElement;
                if (!root.TryGetProperty("items", out var items)) continue;

                foreach (var it in items.EnumerateArray())
                {
                    string name = it.GetProperty("name").GetString() ?? "";
                    if (string.IsNullOrWhiteSpace(name)) continue;

                    found.Add(new Device
                    {
                        Name = name,
                        HasFeeder = it.TryGetProperty("feeder", out var f) && f.GetBoolean(),
                        HasDuplex = it.TryGetProperty("duplex", out var d) && d.GetBoolean(),
                        Wia = it.TryGetProperty("wia", out var w) && w.GetBoolean(),
                    });
                }
            }
            catch { }
        }

        return found;
    }

    // Съёмка. Страницы сообщаются по мере готовности, как и у WIA
    public static List<string> Scan(
        Scanner.Options opt,
        string dir,
        bool showUi,
        Action<int, string> onPage,
        CancellationToken token)
    {
        if (!Available())
            throw new InvalidOperationException("Помощник сканирования не найден. Переустановите программу.");

        Directory.CreateDirectory(dir);

        var args = new List<string> { "scan", Quote(dir) };
        if (!string.IsNullOrEmpty(opt.DeviceName)) { args.Add("--device"); args.Add(Quote(opt.DeviceName)); }
        args.Add("--dpi"); args.Add(opt.Dpi.ToString());
        args.Add("--color"); args.Add(opt.Color);
        if (opt.Feeder) args.Add("--feeder");
        if (opt.Duplex) args.Add("--duplex");
        if (opt.Limit > 0) { args.Add("--limit"); args.Add(opt.Limit.ToString()); }
        if (showUi) args.Add("--ui");

        // Аппарат от службы Windows снимается иначе, чем через драйвер
        if (!string.IsNullOrEmpty(opt.DeviceName) &&
            _viaWia.TryGetValue(opt.DeviceName, out bool byWia) && byWia)
            args.Add("--wia");

        var pages = new List<string>();
        string error = "";

        // Снимаем тем помощником, которому этот аппарат отозвался
        // при опросе: другой разрядности он просто не ответит
        using var p = Start(HelperFor(opt.DeviceName), string.Join(" ", args));

        using (token.Register(() => { try { p.Kill(true); } catch { } }))
        {
            string? line;
            while ((line = p.StandardOutput.ReadLine()) != null)
            {
                string s = line.Trim();
                if (!s.StartsWith("{")) continue;

                try
                {
                    using var doc = JsonDocument.Parse(s);
                    var root = doc.RootElement;

                    // Готовый лист — показываем сразу
                    if (root.TryGetProperty("page", out var idx) &&
                        root.TryGetProperty("path", out var path))
                    {
                        string file = path.GetString() ?? "";
                        if (file.Length > 0)
                        {
                            pages.Add(file);
                            onPage(idx.GetInt32(), file);
                        }
                        continue;
                    }

                    if (root.TryGetProperty("ok", out var ok) && !ok.GetBoolean())
                        error = root.TryGetProperty("error", out var e) ? e.GetString() ?? "" : "";

                    // Настройки, которые сканер не принял: снимок сделан,
                    // но не совсем такой, как просили
                    if (root.TryGetProperty("refused", out var bad) &&
                        bad.ValueKind == JsonValueKind.Array)
                    {
                        Ignored.Clear();
                        foreach (var b in bad.EnumerateArray())
                        {
                            string t = b.GetString() ?? "";
                            if (t.Length > 0) Ignored.Add(t);
                        }
                    }
                }
                catch { }
            }

            p.WaitForExit();
        }

        token.ThrowIfCancellationRequested();

        if (pages.Count == 0)
            throw new InvalidOperationException(
                error.Length > 0 ? error : "Сканер не передал ни одной страницы.");

        return pages;
    }

    static string Quote(string s) => s.Contains(' ') ? $"\"{s}\"" : s;
}