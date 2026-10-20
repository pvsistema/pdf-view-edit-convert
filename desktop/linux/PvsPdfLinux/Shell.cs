using System.Diagnostics;

namespace PvsPdfLinux;

// Запуск системных команд. Аргументы передаём списком, а не строкой:
// так имя файла с пробелами или кавычками не превратится в лишнюю команду
internal static class Shell
{
    public sealed record Result(int Code, string Out, string Err);

    public static bool Exists(string tool)
    {
        if (tool.Contains('/')) return File.Exists(tool);
        string path = Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin";
        foreach (string dir in path.Split(':', StringSplitOptions.RemoveEmptyEntries))
        {
            if (File.Exists(Path.Combine(dir, tool))) return true;
        }
        return false;
    }

    public static Result Run(string tool, IEnumerable<string> args, int timeoutMs = 30000, CancellationToken token = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName = tool,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (string a in args) psi.ArgumentList.Add(a);

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Не удалось запустить " + tool);
        var outTask = p.StandardOutput.ReadToEndAsync();
        var errTask = p.StandardError.ReadToEndAsync();

        var sw = Stopwatch.StartNew();
        while (!p.WaitForExit(200))
        {
            if (token.IsCancellationRequested || sw.ElapsedMilliseconds > timeoutMs)
            {
                try { p.Kill(true); } catch { }
                token.ThrowIfCancellationRequested();
                throw new TimeoutException(tool + " не ответил вовремя");
            }
        }
        p.WaitForExit();
        return new Result(p.ExitCode, outTask.Result, errTask.Result);
    }

    // Запуск без ожидания: открыть папку, ссылку, программу настройки
    public static void Start(string tool, params string[] args)
    {
        var psi = new ProcessStartInfo { FileName = tool, UseShellExecute = false };
        foreach (string a in args) psi.ArgumentList.Add(a);
        Process.Start(psi);
    }

    // Файл, папка или ссылка — в программе, которую выбрал пользователь
    public static void Open(string target)
    {
        if (Exists("xdg-open")) { Start("xdg-open", target); return; }
        if (Exists("gio")) { Start("gio", "open", target); return; }
        throw new InvalidOperationException("В системе нет команды xdg-open");
    }
}
