using System.Text;

namespace PvsPdfLinux;

// Журнал программы: ~/.local/share/pvspdf/logs. Хранится две недели
internal static class AppLog
{
    const int KeepDays = 14;
    const long MaxFileBytes = 2 * 1024 * 1024;

    static readonly object _lock = new();
    static bool _headerWritten;

    public static string Dir => Paths.LogsDir;

    static string TodayFile => Path.Combine(Dir, $"pvspdf-{DateTime.Now:yyyy-MM-dd}.log");

    public static void Info(string area, string message) => Write("INFO ", area, message, null);

    public static void Warn(string area, string message) => Write("WARN ", area, message, null);

    public static void Error(string area, string message, Exception? ex = null) =>
        Write("ERROR", area, message, ex);

    static void Write(string level, string area, string message, Exception? ex)
    {
        try
        {
            var sb = new StringBuilder();
            sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"))
              .Append(' ').Append(level)
              .Append(" [").Append(area).Append("] ")
              .Append(OneLine(message));
            if (ex != null)
            {
                sb.Append("\n    ").Append(ex.GetType().Name).Append(": ").Append(OneLine(ex.Message));
                if (ex.StackTrace != null)
                    sb.Append("\n    ").Append(ex.StackTrace.Replace("\n", "\n    "));
            }
            sb.Append('\n');

            lock (_lock)
            {
                Directory.CreateDirectory(Dir);
                string file = TodayFile;
                if (File.Exists(file) && new FileInfo(file).Length > MaxFileBytes) return;

                if (!_headerWritten)
                {
                    _headerWritten = true;
                    File.AppendAllText(file,
                        "\n===== Запуск " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
                        " | версия " + Paths.Version() +
                        " | " + OsName() + " =====\n", Encoding.UTF8);
                }
                File.AppendAllText(file, sb.ToString(), Encoding.UTF8);
            }
        }
        catch { }
    }

    // Название системы из /etc/os-release: «Astra Linux 1.7», «РЕД ОС 7.3»
    public static string OsName()
    {
        try
        {
            foreach (string line in File.ReadAllLines("/etc/os-release"))
            {
                if (line.StartsWith("PRETTY_NAME="))
                    return line.Substring(12).Trim('"');
            }
        }
        catch { }
        return Environment.OSVersion.VersionString;
    }

    static string OneLine(string s) => (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();

    public static void Cleanup()
    {
        try
        {
            if (!Directory.Exists(Dir)) return;
            DateTime edge = DateTime.Now.AddDays(-KeepDays);
            foreach (string f in Directory.GetFiles(Dir, "pvspdf-*.log"))
            {
                try { if (File.GetLastWriteTime(f) < edge) File.Delete(f); } catch { }
            }
        }
        catch { }
    }

    public static void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            Shell.Open(Dir);
        }
        catch (Exception ex)
        {
            Error("журнал", "Не удалось открыть папку журналов", ex);
        }
    }
}
