using System.Runtime.InteropServices;

namespace PvsPdfLinux;

// Где что лежит. Программа ставится в /opt/pvspdf и там же только читается;
// всё, что меняется (настройки, лицензия, журналы, открытые документы),
// хранится в домашней папке пользователя — так программой могут
// пользоваться несколько человек на одном компьютере
internal static class Paths
{
    public static string AppDir => AppContext.BaseDirectory;

    public static string WebRoot => Path.Combine(AppDir, "web");

    public static string DataDir { get; } = MakeDataDir();

    public static string OpenDir => Path.Combine(DataDir, "open");

    public static string LogsDir => Path.Combine(DataDir, "logs");

    public static string SocketPath => Path.Combine(DataDir, "pvspdf.sock");

    public static string LockPath => Path.Combine(DataDir, "pvspdf.lock");

    static string MakeDataDir()
    {
        string baseDir = Environment.GetEnvironmentVariable("XDG_DATA_HOME") ?? "";
        if (string.IsNullOrWhiteSpace(baseDir))
            baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
        string dir = Path.Combine(baseDir, "pvspdf");
        try { Directory.CreateDirectory(dir); } catch { }
        return dir;
    }

    public static string Version()
    {
        try
        {
            string f = Path.Combine(AppDir, "app_version.txt");
            if (File.Exists(f)) return File.ReadAllText(f).Trim();
        }
        catch { }
        return "1.0.0";
    }

    // Тип пакета, которым программа поставлена: от него зависит,
    // какой файл качать при обновлении
    public static string PackageKind()
    {
        try
        {
            string f = Path.Combine(AppDir, "package_kind.txt");
            if (File.Exists(f)) return File.ReadAllText(f).Trim();
        }
        catch { }
        return File.Exists("/usr/bin/dpkg") ? "deb" : "rpm";
    }

    [DllImport("libc")]
    static extern uint getuid();

    public static uint Uid()
    {
        try { return getuid(); } catch { return 1000; }
    }
}
