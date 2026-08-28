using System.Diagnostics;
using System.Text.Json;

namespace PvsPdfApp;

// Связь с помощником сканирования (PVSPDF-twain.exe). Он 32-разрядный
// и умеет работать с драйверами производителей — теми же, что использует
// FineReader. Благодаря этому программа видит сканеры, о которых Windows
// не знает: Kyocera и другие МФУ, где поставлен только драйвер TWAIN.
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
    }

    // Помощник лежит рядом с программой
    public static string ExePath()
    {
        string dir = AppContext.BaseDirectory;
        return Path.Combine(dir, "PVSPDF-twain.exe");
    }

    public static bool Available() => File.Exists(ExePath());

    static Process Start(string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = ExePath(),
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };

        return Process.Start(psi) ?? throw new InvalidOperationException(
            "Не удалось запустить помощник сканирования.");
    }

    // Какое качество поддерживает аппарат. Пустой список означает
    // «выяснить не удалось» — тогда показываем обычный набор значений
    public static List<int> Resolutions(string device)
    {
        var found = new List<int>();
        if (!Available() || string.IsNullOrWhiteSpace(device)) return found;

        try
        {
            using var p = Start($"caps --device {Quote(device)}");
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

    // Список сканеров, известных драйверам TWAIN
    public static List<Device> List()
    {
        var found = new List<Device>();
        if (!Available()) return found;

        try
        {
            using var p = Start("list");

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
                    });
                }
            }
        }
        catch { }

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

        var pages = new List<string>();
        string error = "";

        using var p = Start(string.Join(" ", args));

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