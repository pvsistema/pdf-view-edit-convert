using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PvsPdfLinux;

// Сканирование через SANE — стандартную систему сканеров Linux.
// Работает с любым аппаратом, для которого в системе есть драйвер SANE:
// большинство USB- и сетевых МФУ (Canon, HP, Epson, Kyocera, Brother,
// Pantum, Xerox), сетевые — через sane-airscan (протокол eSCL/WSD)
internal static class Scanner
{
    public sealed class Device
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public bool HasFeeder { get; set; }
        public bool HasDuplex { get; set; }
        public bool Manual { get; set; }
    }

    public sealed class Options
    {
        public string DeviceId { get; set; } = "";
        public int Dpi { get; set; } = 300;
        public string Color { get; set; } = "color";
        public bool Feeder { get; set; }
        public bool Duplex { get; set; }
        public int Limit { get; set; }
    }

    // Что аппарат умеет — по ответу драйвера на «scanimage -A»
    sealed class Caps
    {
        public List<string> Sources { get; } = new();
        public List<string> Modes { get; } = new();
        public List<int> Dpi { get; } = new();
    }

    public static bool Available => Shell.Exists("scanimage");

    // Настройки, которые аппарат не поддержал при последней съёмке
    public static List<string> Ignored { get; } = new();

    public static List<Device> List()
    {
        var list = new List<Device>();
        if (!Available) return AddManual(list);

        try
        {
            var r = Shell.Run("scanimage", new[] { "-f", "%d\t%v %m%n" }, 40000);
            foreach (string line in r.Out.Split('\n'))
            {
                string[] p = line.Split('\t');
                if (p.Length < 2 || p[0].Trim().Length == 0) continue;

                string id = p[0].Trim();
                if (list.Any(d => d.Id == id)) continue;

                var caps = ReadCaps(id);
                list.Add(new Device
                {
                    Id = id,
                    Name = Pretty(p[1].Trim(), id),
                    HasFeeder = caps?.Sources.Any(IsFeeder) ?? false,
                    HasDuplex = caps?.Sources.Any(IsDuplex) ?? false,
                });
            }
        }
        catch (Exception ex)
        {
            AppLog.Warn("сканер", "Опрос сканеров не удался: " + ex.Message);
        }

        return AddManual(list);
    }

    static List<Device> AddManual(List<Device> list)
    {
        foreach (var m in ManualScanners.All())
        {
            if (list.Any(d => d.Id == m.Name)) continue;
            list.Add(new Device
            {
                Id = m.Name,
                Name = m.Name,
                HasFeeder = m.Feeder,
                HasDuplex = m.Duplex,
                Manual = true,
            });
        }
        return list;
    }

    // Сетевой аппарат через sane-airscan приходит дважды (eSCL и WSD) —
    // подписываем способ подключения, чтобы было понятно, что выбирать
    static string Pretty(string name, string id)
    {
        if (id.StartsWith("airscan:e")) return name + " (сеть, eSCL)";
        if (id.StartsWith("airscan:w")) return name + " (сеть, WSD)";
        if (id.StartsWith("escl:")) return name + " (сеть)";
        if (id.Contains("libusb")) return name + " (USB)";
        return name;
    }

    static bool IsFeeder(string s) =>
        Regex.IsMatch(s, "adf|feeder|duplex|податчик", RegexOptions.IgnoreCase);

    static bool IsDuplex(string s) =>
        Regex.IsMatch(s, "duplex|двусторон", RegexOptions.IgnoreCase);

    static Caps? ReadCaps(string device)
    {
        try
        {
            var r = Shell.Run("scanimage", new[] { "-d", device, "-A" }, 20000);
            var caps = new Caps();
            foreach (string raw in r.Out.Split('\n'))
            {
                string line = raw.Trim();
                if (line.StartsWith("--source ")) caps.Sources.AddRange(Choices(line, "--source "));
                else if (line.StartsWith("--mode ")) caps.Modes.AddRange(Choices(line, "--mode "));
                else if (line.StartsWith("--resolution ")) caps.Dpi.AddRange(ParseResolutions(line));
            }
            return caps;
        }
        catch { return null; }
    }

    // «--source Flatbed|ADF|ADF Duplex [Flatbed]» → Flatbed, ADF, ADF Duplex
    static IEnumerable<string> Choices(string line, string prefix)
    {
        string v = line.Substring(prefix.Length);
        int br = v.LastIndexOf(" [", StringComparison.Ordinal);
        if (br >= 0) v = v[..br];
        return v.Split('|').Select(s => s.Trim()).Where(s => s.Length > 0);
    }

    // «--resolution 75|150|300|600dpi [300]» или «50..1200dpi (in steps of 1)»
    static IEnumerable<int> ParseResolutions(string line)
    {
        string v = line.Substring("--resolution ".Length);
        int br = v.IndexOf(" [", StringComparison.Ordinal);
        if (br >= 0) v = v[..br];
        v = v.Replace("dpi", "");

        var range = Regex.Match(v, @"(\d+)\.\.(\d+)");
        if (range.Success)
        {
            int min = int.Parse(range.Groups[1].Value);
            int max = int.Parse(range.Groups[2].Value);
            return new[] { 75, 100, 150, 200, 300, 400, 600, 1200 }.Where(d => d >= min && d <= max);
        }

        var list = new List<int>();
        foreach (string s in v.Split('|'))
        {
            if (int.TryParse(Regex.Match(s, @"\d+").Value, out int d) && d > 0) list.Add(d);
        }
        return list;
    }

    public static int[] Resolutions(string device)
    {
        var caps = ReadCaps(device);
        return caps?.Dpi.Distinct().OrderBy(d => d).ToArray() ?? Array.Empty<int>();
    }

    // Съёмка. Каждый готовый лист сразу уходит в интерфейс
    public static List<string> Scan(Options opt, string dir, Action<int, string> onPage, CancellationToken token)
    {
        if (!Available)
            throw new InvalidOperationException(
                "Не установлена система сканирования SANE (пакет sane-utils или sane). " +
                "Установите её и перезапустите программу.");

        Directory.CreateDirectory(dir);
        Ignored.Clear();

        var caps = ReadCaps(opt.DeviceId) ?? new Caps();
        var args = new List<string> { "-d", opt.DeviceId, "--format=png" };

        // Качество: ближайшее из того, что аппарат умеет
        int dpi = opt.Dpi;
        if (caps.Dpi.Count > 0 && !caps.Dpi.Contains(dpi))
        {
            int near = caps.Dpi.OrderBy(d => Math.Abs(d - dpi)).First();
            Ignored.Add($"Качество {dpi} точек на дюйм — сканер снимает в {near}");
            dpi = near;
        }
        args.Add("--resolution"); args.Add(dpi.ToString());

        string? mode = PickMode(caps, opt.Color);
        if (mode != null) { args.Add("--mode"); args.Add(mode); }
        else if (caps.Modes.Count > 0) Ignored.Add("Цветность — сканер снимает в своём режиме");

        bool batch = false;
        if (opt.Feeder)
        {
            string? src = opt.Duplex
                ? caps.Sources.FirstOrDefault(IsDuplex)
                : caps.Sources.FirstOrDefault(s => IsFeeder(s) && !IsDuplex(s));
            if (src == null && opt.Duplex)
            {
                src = caps.Sources.FirstOrDefault(IsFeeder);
                if (src != null) Ignored.Add("Двусторонняя съёмка — сканер снимает одну сторону");
            }

            if (src != null)
            {
                args.Add("--source"); args.Add(src);
                batch = true;
            }
            else
            {
                Ignored.Add("Автоподатчик — снимок сделан со стекла");
            }
        }
        else
        {
            string? flat = caps.Sources.FirstOrDefault(s => Regex.IsMatch(s, "flatbed|планшет|normal", RegexOptions.IgnoreCase));
            if (flat != null) { args.Add("--source"); args.Add(flat); }
        }

        var files = new List<string>();

        if (batch)
        {
            args.Add("--batch=" + Path.Combine(dir, "page_%03d.png"));
            args.Add("--batch-print");
            if (opt.Limit > 0) args.Add("--batch-count=" + opt.Limit);

            RunStreaming(args, line =>
            {
                string f = line.Trim();
                if (f.Length == 0 || !File.Exists(f)) return;
                files.Add(f);
                onPage(files.Count, f);
            }, token, out string err);

            // Пустой податчик в конце пачки — это не ошибка
            if (files.Count == 0)
                throw new InvalidOperationException(ExplainError(err, true));
        }
        else
        {
            string file = Path.Combine(dir, "page_001.png");
            args.Add("--output-file=" + file);
            RunStreaming(args, _ => { }, token, out string err);
            if (!File.Exists(file) || new FileInfo(file).Length == 0)
                throw new InvalidOperationException(ExplainError(err, false));
            files.Add(file);
            onPage(1, file);
        }

        return files;
    }

    static string? PickMode(Caps caps, string color)
    {
        if (caps.Modes.Count == 0) return color switch { "gray" => "Gray", "bw" => "Lineart", _ => "Color" };
        string pattern = color switch
        {
            "gray" => "gray|grey|серый|оттенк",
            "bw" => "lineart|binary|black|halftone|чёрно|черно",
            _ => "color|colour|цвет",
        };
        return caps.Modes.FirstOrDefault(m => Regex.IsMatch(m, pattern, RegexOptions.IgnoreCase));
    }

    static string ExplainError(string err, bool feeder)
    {
        string e = err.ToLowerInvariant();
        if (e.Contains("no docs") || e.Contains("document feeder out of documents") || e.Contains("out of documents"))
            return feeder ? "В автоподатчике нет листов." : "Сканер не нашёл документ.";
        if (e.Contains("device busy")) return "Сканер занят другой программой. Закройте её и попробуйте снова.";
        if (e.Contains("invalid argument") || e.Contains("open of device")) return "Не удалось подключиться к сканеру. Проверьте, что он включён.";
        if (e.Contains("jammed")) return "В сканере застряла бумага.";
        if (e.Contains("cover open")) return "Откройте и закройте крышку сканера.";
        string tail = err.Trim();
        return tail.Length > 0 ? "Сканер сообщил: " + tail : "Сканер не вернул снимок.";
    }

    static void RunStreaming(List<string> args, Action<string> onLine, CancellationToken token, out string error)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "scanimage",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (string a in args) psi.ArgumentList.Add(a);

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Не удалось запустить scanimage");
        var err = new StringBuilder();
        p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (err) err.AppendLine(e.Data); };
        p.OutputDataReceived += (s, e) => { if (e.Data != null) onLine(e.Data); };
        p.BeginErrorReadLine();
        p.BeginOutputReadLine();

        while (!p.WaitForExit(250))
        {
            if (token.IsCancellationRequested)
            {
                try { p.Kill(true); } catch { }
                token.ThrowIfCancellationRequested();
            }
        }
        p.WaitForExit();
        lock (err) error = err.ToString();
        AppLog.Info("сканер", $"scanimage завершился с кодом {p.ExitCode}: {error.Trim()}");
    }

    // Подсказка, когда не найдено ни одного аппарата
    public static string Diagnose()
    {
        if (!Available)
            return "Не установлена система сканирования SANE. Установите пакет «sane-utils» " +
                   "(Astra Linux) или «sane-backends» (РЕД ОС, Альт), для сетевых МФУ — ещё и " +
                   "«sane-airscan», затем нажмите «Искать снова».";

        return "Проверьте, что сканер включён и подключён. Для USB-аппарата нужен драйвер SANE " +
               "от производителя (Kyocera, Pantum, Canon дают его на своих сайтах). Сетевое МФУ " +
               "находится через пакет «sane-airscan». Если сканер видит только администратор, " +
               "добавьте пользователя в группы «scanner» и «lp» и войдите в систему заново.";
    }

    // Программы сканирования, установленные в системе. Их можно открыть
    // одной кнопкой — у некоторых аппаратов свои настройки
    public sealed record Setup(string Name, string Path, bool Main, bool Network);

    public static List<Setup> Setups()
    {
        var known = new (string Tool, string Name)[]
        {
            ("simple-scan", "Простое сканирование"),
            ("xsane", "XSane — расширенные настройки сканера"),
            ("skanlite", "Skanlite"),
            ("fly-scan", "Сканер Fly (Astra Linux)"),
            ("kyocera-scanner-config", "Настройка сканера Kyocera"),
            ("pantum-scan", "Сканирование Pantum"),
        };

        var list = new List<Setup>();
        foreach (var (tool, name) in known)
        {
            string? path = Which(tool);
            if (path != null) list.Add(new Setup(name, path, false, false));
        }
        return list;
    }

    static string? Which(string tool)
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin";
        foreach (string dir in path.Split(':', StringSplitOptions.RemoveEmptyEntries))
        {
            string f = System.IO.Path.Combine(dir, tool);
            if (File.Exists(f)) return f;
        }
        return null;
    }

    // Имена аппаратов, которые знает SANE — подсказка при ручном добавлении
    public static string[] Registered()
    {
        if (!Available) return Array.Empty<string>();
        try
        {
            var r = Shell.Run("scanimage", new[] { "-f", "%d%n" }, 30000);
            return r.Out.Split('\n').Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    // Отчёт о поиске: что видит SANE, какие драйверы стоят, в каких
    // группах пользователь. Причина обычно видна сразу
    public static string SelfTest()
    {
        var sb = new StringBuilder();
        sb.AppendLine("Отчёт о поиске сканеров — ПВ-Система PDF " + Paths.Version());
        sb.AppendLine("Дата: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
        sb.AppendLine("Система: " + AppLog.OsName());
        sb.AppendLine("Пользователь: " + Environment.UserName);
        sb.AppendLine();

        Section(sb, "Версия SANE", "scanimage", "--version");
        Section(sb, "Найденные сканеры (scanimage -L)", "scanimage", "-L");
        Section(sb, "Устройства на USB (sane-find-scanner)", "sane-find-scanner", "-q");
        Section(sb, "Группы пользователя", "id", "-nG");

        sb.AppendLine("== Включённые драйверы (/etc/sane.d/dll.conf) ==");
        try
        {
            foreach (string line in File.ReadAllLines("/etc/sane.d/dll.conf"))
            {
                string l = line.Trim();
                if (l.Length > 0 && !l.StartsWith('#')) sb.Append(l).Append(' ');
            }
            sb.AppendLine();
        }
        catch (Exception ex) { sb.AppendLine("не прочитан: " + ex.Message); }
        sb.AppendLine();

        sb.AppendLine("== Добавлены вручную ==");
        foreach (var m in ManualScanners.All()) sb.AppendLine(m.Name);
        sb.AppendLine();

        sb.AppendLine("== Программы сканирования ==");
        foreach (var s in Setups()) sb.AppendLine(s.Name + " — " + s.Path);

        return sb.ToString();
    }

    static void Section(StringBuilder sb, string title, string tool, params string[] args)
    {
        sb.AppendLine("== " + title + " ==");
        try
        {
            if (!Shell.Exists(tool)) { sb.AppendLine("команда " + tool + " не установлена"); }
            else
            {
                var r = Shell.Run(tool, args, 40000);
                string text = (r.Out + r.Err).Trim();
                sb.AppendLine(text.Length > 0 ? text : "(пусто)");
            }
        }
        catch (Exception ex) { sb.AppendLine("ошибка: " + ex.Message); }
        sb.AppendLine();
    }
}

// Сканеры, добавленные вручную: сетевой адрес SANE, который сам не находится
internal static class ManualScanners
{
    public sealed class Item
    {
        public string Name { get; set; } = "";
        public bool Feeder { get; set; }
        public bool Duplex { get; set; }
    }

    static readonly string FilePath = Path.Combine(Paths.DataDir, "scanners.json");

    public static List<Item> All()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<List<Item>>(File.ReadAllText(FilePath)) ?? new();
        }
        catch { }
        return new();
    }

    public static void Add(Item item)
    {
        if (string.IsNullOrWhiteSpace(item.Name)) return;
        var list = All();
        list.RemoveAll(i => i.Name == item.Name);
        list.Add(item);
        Save(list);
    }

    public static void Remove(string name)
    {
        var list = All();
        list.RemoveAll(i => i.Name == name);
        Save(list);
    }

    static void Save(List<Item> list)
    {
        try { File.WriteAllText(FilePath, JsonSerializer.Serialize(list)); } catch { }
    }
}
