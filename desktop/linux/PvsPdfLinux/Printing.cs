namespace PvsPdfLinux;

// Печать через CUPS — стандартную систему печати Linux (Astra, РЕД ОС,
// Альт). Документ уходит на принтер напрямую, без лишних окон
internal static class Printing
{
    // Список принтеров, первым идёт принтер по умолчанию
    public static string[] List()
    {
        try
        {
            if (!Shell.Exists("lpstat")) return Array.Empty<string>();

            var names = new List<string>();
            var r = Shell.Run("lpstat", new[] { "-e" }, 8000);
            foreach (string line in r.Out.Split('\n'))
            {
                string n = line.Trim();
                if (n.Length > 0 && !names.Contains(n)) names.Add(n);
            }

            string def = Default();
            return names
                .OrderByDescending(n => n == def)
                .ThenBy(n => n, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (Exception ex)
        {
            AppLog.Warn("печать", "Не удалось получить список принтеров: " + ex.Message);
            return Array.Empty<string>();
        }
    }

    static string Default()
    {
        try
        {
            // «system default destination: HP_LaserJet» — имя после двоеточия
            var r = Shell.Run("lpstat", new[] { "-d" }, 5000);
            int i = r.Out.LastIndexOf(':');
            return i >= 0 ? r.Out[(i + 1)..].Trim() : "";
        }
        catch { return ""; }
    }

    // Возвращает имя принтера, на который ушёл документ
    public static string Print(string pdfPath, string printer, string title, string duplex = "off")
    {
        if (!Shell.Exists("lp"))
            throw new InvalidOperationException(
                "В системе не установлена служба печати CUPS (команда lp).");

        var args = new List<string>();
        if (!string.IsNullOrWhiteSpace(printer)) { args.Add("-d"); args.Add(printer); }
        args.Add("-t"); args.Add(string.IsNullOrWhiteSpace(title) ? "document.pdf" : title);
        // Масштаб «по размеру листа»: документ не обрежется по краям
        args.Add("-o"); args.Add("fit-to-page");
        // Двусторонняя печать: поля оборота программа уже выровняла,
        // CUPS остаётся переворачивать лист по нужному краю
        args.Add("-o");
        args.Add(duplex switch
        {
            "long" => "sides=two-sided-long-edge",
            "short" => "sides=two-sided-short-edge",
            _ => "sides=one-sided",
        });
        args.Add("--"); args.Add(pdfPath);

        var r = Shell.Run("lp", args, 60000);
        if (r.Code != 0)
        {
            string err = (r.Err + " " + r.Out).Trim();
            throw new InvalidOperationException(err.Length > 0 ? err : "Принтер не принял документ.");
        }
        return string.IsNullOrWhiteSpace(printer) ? Default() : printer;
    }

    // Настройки принтера: системное окно, если есть, иначе страница CUPS
    public static void OpenSetup(string printer)
    {
        foreach (string tool in new[] { "system-config-printer", "fly-admin-printer", "kde-add-printer" })
        {
            if (!Shell.Exists(tool)) continue;
            Shell.Start(tool);
            return;
        }

        string url = string.IsNullOrWhiteSpace(printer)
            ? "http://localhost:631/printers/"
            : "http://localhost:631/printers/" + Uri.EscapeDataString(printer);
        Shell.Open(url);
    }
}
