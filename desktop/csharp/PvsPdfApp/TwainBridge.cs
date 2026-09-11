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

    // Имя без служебных хвостов: один аппарат зовётся по-разному
    // в списке, у драйвера и у службы Windows
    static string Plain(string name)
    {
        string s = name.Trim();

        int hash = s.LastIndexOf('#');
        if (hash > 0) s = s.Substring(0, hash);

        s = s.ToLowerInvariant();

        foreach (string tail in new[]
        {
            "twain driver", "wia driver", "wia-driver", "twain ds",
            "twain", "wia", "driver", "scanner", "сканер",
        })
        {
            if (s.EndsWith(" " + tail)) s = s.Substring(0, s.Length - tail.Length - 1).Trim();
        }

        var keep = new System.Text.StringBuilder();
        foreach (char c in s)
            if (char.IsLetterOrDigit(c)) keep.Append(c);

        return keep.ToString();
    }

    // В каком порядке пробовать помощников.
    //
    // Разрядность решает всё: 32-разрядный помощник видит ТОЛЬКО
    // драйверы из twain_32, 64-разрядный — только из twain_64. Они
    // не видят друг друга вовсе. Драйверы Kyocera, Canon, Epson,
    // HP чаще всего 32-разрядные — в панели управления такой драйвер
    // прямо и зовётся «Kyocera TWAIN (32-bit)».
    //
    // Раньше мы брали ОДНОГО помощника и на нём останавливались. Если
    // угадали неверно, аппарат «не найден» — хотя его драйвер стоит
    // рядом, просто в другой разрядности. Теперь пробуем обоих
    static List<string> HelpersFor(string device)
    {
        var order = new List<string>();

        string known = HelperFor(device);
        if (File.Exists(known)) order.Add(known);

        // 32-разрядный ставим следующим: там живёт большинство
        // драйверов производителей
        foreach (string exe in new[] { ExePath(), ExePath64() })
            if (File.Exists(exe) && !order.Contains(exe, StringComparer.OrdinalIgnoreCase))
                order.Add(exe);

        return order;
    }

    static string HelperFor(string device)
    {
        if (!string.IsNullOrWhiteSpace(device))
        {
            if (_owner.TryGetValue(device, out string? exe) && File.Exists(exe)) return exe;

            // Записали под одним написанием, спрашивают под другим —
            // ищем по сути имени
            string want = Plain(device);
            foreach (var pair in _owner)
                if (Plain(pair.Key) == want && File.Exists(pair.Value)) return pair.Value;
        }

        var all = Helpers();
        return all.Count > 0 ? all[0] : ExePath();
    }

    // Нашёлся ли аппарат службой Windows. Сверяем по сути имени:
    // записано могло быть другое написание
    static bool ByWia(string device)
    {
        if (_viaWia.TryGetValue(device, out bool exact)) return exact;

        string want = Plain(device);
        foreach (var pair in _viaWia)
            if (Plain(pair.Key) == want) return pair.Value;

        return false;
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

            // Ругань помощника читаем тоже. Без этого его падение
            // выглядело как «просто ноль страниц»: настоящая причина
            // уходила в пустоту, и на экран шла голая фраза без объяснений
            RedirectStandardError = true,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
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

        // Аппарат от службы Windows снимается иначе, чем через драйвер.
        //
        // Проверку «жива ли служба» я отсюда убрал: она спрашивала
        // старым способом, который на этом компьютере мёртв, всегда
        // получала ноль — и отправляла WIA-сканер к драйверу, которого
        // у него нет. Помощник умеет спросить службу по-новому сам,
        // и решать за него не нужно
        if (!string.IsNullOrEmpty(opt.DeviceName) && ByWia(opt.DeviceName))
            args.Add("--wia");

        // Пробуем помощников по очереди: аппарат отзывается только
        // «своей» разрядности, а угадать её заранее нельзя
        var helpers = HelpersFor(opt.DeviceName);
        var trouble = new List<string>();

        for (int i = 0; i < helpers.Count; i++)
        {
            bool last = i == helpers.Count - 1;

            try
            {
                var got = RunHelper(helpers[i], args, dir, onPage, token);
                if (got.Count > 0) return got;

                trouble.Add(Path.GetFileName(helpers[i]) + ": страниц нет");
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                trouble.Add(Path.GetFileName(helpers[i]) + ": " + ex.Message);
            }

            // Драйвер отпускает аппарат не мгновенно. Без паузы второй
            // помощник застаёт его занятым — это и есть окно
            // «TWAIN Driver is already running»
            if (!last) System.Threading.Thread.Sleep(1200);

            if (last)
                throw new InvalidOperationException(
                    "Сканер не передал ни одной страницы.\n\nЧто происходило:\n" +
                    string.Join("\n", trouble));
        }

        throw new InvalidOperationException("Помощник сканирования не запустился.");
    }

    // Один заход одним помощником
    static List<string> RunHelper(
        string helper,
        List<string> args,
        string dir,
        Action<int, string> onPage,
        CancellationToken token)
    {
        var pages = new List<string>();
        string error = "";

        using var p = Start(helper, string.Join(" ", args));

        // Поток ругани читаем ОТДЕЛЬНОЙ нитью. Если этого не делать,
        // труба переполняется и помощник встаёт намертво
        string crash = "";
        var errReader = System.Threading.Tasks.Task.Run(() =>
        {
            try { crash = p.StandardError.ReadToEnd().Trim(); } catch { }
        });

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

        try { errReader.Wait(3000); } catch { }

        token.ThrowIfCancellationRequested();

        if (pages.Count == 0)
        {
            var why = new System.Text.StringBuilder();
            why.Append(error.Length > 0 ? error : "Сканер не передал ни одной страницы.");

            // Всё, что поможет понять причину: код завершения,
            // какой помощник работал и на что он жаловался
            var facts = new List<string>();

            try
            {
                if (p.ExitCode != 0 && error.Length == 0)
                    facts.Add("помощник завершился с кодом " + p.ExitCode);
            }
            catch { }

            facts.Add("способ: " + (args.Contains("--wia") ? "служба Windows" : "драйвер производителя"));

            if (crash.Length > 0)
            {
                string tail = crash.Length > 500 ? crash.Substring(0, 500) : crash;
                facts.Add("сообщение помощника: " + tail);
            }

            if (ChooseLog.Count > 0)
                facts.Add("поиск: " + string.Join("; ", ChooseLog.Take(6)));

            if (facts.Count > 0)
                why.Append("\n\nЧто происходило:\n" + string.Join("\n", facts));

            throw new InvalidOperationException(why.ToString());
        }

        return pages;
    }

    static string Quote(string s) => s.Contains(' ') ? $"\"{s}\"" : s;
}