using System.Text;

namespace PvsPdfApp;

// Журнал ошибок программы. По нему при жалобе пользователя видно,
// что именно и когда пошло не так.
//
// Лежит в C:\PVSPDF\logs, по файлу на день: pvspdf-2026-10-18.log.
// Хранится две недели, старые файлы удаляются сами. Один файл не
// растёт больше 2 МБ — журнал никогда не забьёт диск.
// Содержимое документов сюда не попадает: только что делала программа
// и чем это закончилось.
internal static class AppLog
{
    const int KeepDays = 14;
    const long MaxFileBytes = 2 * 1024 * 1024;

    static readonly object _lock = new();
    static bool _headerWritten;

    public static string Dir => Path.Combine(Program.InstallDir, "logs");

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
                sb.Append("\r\n    ").Append(ex.GetType().Name).Append(": ").Append(OneLine(ex.Message));
                if (ex.StackTrace != null)
                    sb.Append("\r\n    ").Append(ex.StackTrace.Replace("\n", "\n    "));
                if (ex.InnerException != null)
                    sb.Append("\r\n    причина: ").Append(ex.InnerException.GetType().Name)
                      .Append(": ").Append(OneLine(ex.InnerException.Message));
            }
            sb.Append("\r\n");

            lock (_lock)
            {
                Directory.CreateDirectory(Dir);
                string file = TodayFile;

                // Файл за день переполнен — дальше не пишем, чтобы не забить диск
                if (File.Exists(file) && new FileInfo(file).Length > MaxFileBytes) return;

                if (!_headerWritten)
                {
                    _headerWritten = true;
                    File.AppendAllText(file, Header(), Encoding.UTF8);
                }
                File.AppendAllText(file, sb.ToString(), Encoding.UTF8);
            }
        }
        catch
        {
            // Журнал не должен ронять программу ни при каких условиях
        }
    }

    // Сведения о запуске: без них запись в журнале не с чем сопоставить
    static string Header()
    {
        string version = "";
        try
        {
            version = System.Reflection.Assembly.GetExecutingAssembly()
                .GetName().Version?.ToString() ?? "";
        }
        catch { }

        return "\r\n===== Запуск " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
               " | версия " + version +
               " | " + Environment.OSVersion.VersionString +
               (Environment.Is64BitOperatingSystem ? " x64" : " x86") +
               " =====\r\n";
    }

    static string OneLine(string s) =>
        (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();

    // Убираем журналы старше двух недель. Вызывается в фоне при запуске
    public static void Cleanup()
    {
        try
        {
            if (!Directory.Exists(Dir)) return;
            DateTime edge = DateTime.Now.AddDays(-KeepDays);
            foreach (string f in Directory.GetFiles(Dir, "pvspdf-*.log"))
            {
                try
                {
                    if (File.GetLastWriteTime(f) < edge) File.Delete(f);
                }
                catch { }
            }
        }
        catch { }
    }

    // Открыть папку журналов в проводнике — чтобы переслать файл в поддержку
    public static void OpenFolder()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = Dir,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            Error("журнал", "Не удалось открыть папку журналов", ex);
        }
    }
}
