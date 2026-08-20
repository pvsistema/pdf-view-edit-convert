using System.Diagnostics;
using System.Text;

namespace PvsPdfApp;

// Загрузка и установка обновления программы.
// Файл скачивается с показом хода загрузки, затем запускается
// тихая установка: программа закрывается сама и открывается заново
internal static class Updater
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(30) };
    static CancellationTokenSource? _cancel;

    public static bool Busy => _cancel != null;

    public static void Stop()
    {
        try { _cancel?.Cancel(); } catch { }
    }

    // Качаем установщик во временную папку.
    // onProgress получает проценты и объём в байтах
    public static async Task<string> DownloadAsync(
        string url,
        string version,
        Action<int, long, long> onProgress,
        CancellationToken token)
    {
        string dir = Path.Combine(Path.GetTempPath(), "PVSPDF-Update");
        Directory.CreateDirectory(dir);
        CleanOld(dir);

        string file = Path.Combine(dir, $"PVSPDF-Setup-{Safe(version)}.exe");
        string temp = file + ".part";
        if (File.Exists(temp)) File.Delete(temp);

        using var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        resp.EnsureSuccessStatusCode();

        long total = resp.Content.Headers.ContentLength ?? 0;
        long got = 0;
        int lastPercent = -1;

        await using (var src = await resp.Content.ReadAsStreamAsync(token))
        await using (var dst = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true))
        {
            var buffer = new byte[1 << 16];
            int read;
            while ((read = await src.ReadAsync(buffer, token)) > 0)
            {
                await dst.WriteAsync(buffer.AsMemory(0, read), token);
                got += read;

                int percent = total > 0 ? (int)(got * 100 / total) : 0;
                if (percent != lastPercent || total == 0)
                {
                    lastPercent = percent;
                    onProgress(percent, got, total);
                }
            }
        }

        if (new FileInfo(temp).Length < 1024)
        {
            File.Delete(temp);
            throw new InvalidOperationException("Файл обновления получен не полностью.");
        }

        if (File.Exists(file)) File.Delete(file);
        File.Move(temp, file);
        onProgress(100, got, total > 0 ? total : got);
        return file;
    }

    // Готовим и запускаем помощника установки.
    // Он ждёт закрытия программы, останавливает её службы и процессы,
    // ставит новую версию и запускает её снова
    public static void RunInstaller(string setupPath)
    {
        string dir = Path.GetDirectoryName(setupPath)!;
        string script = Path.Combine(dir, "install.cmd");
        string exe = Path.Combine(Program.InstallDir, "PVSPDF.exe");
        int pid = Environment.ProcessId;

        var cmd = new StringBuilder();
        cmd.AppendLine("@echo off");
        cmd.AppendLine("chcp 65001 >nul 2>&1");
        cmd.AppendLine("setlocal");

        // Ждём, пока программа закроется сама (до 30 секунд)
        cmd.AppendLine($"set PID={pid}");
        cmd.AppendLine("set /a WAIT=0");
        cmd.AppendLine(":waitloop");
        cmd.AppendLine("tasklist /FI \"PID eq %PID%\" 2>nul | find \"%PID%\" >nul");
        cmd.AppendLine("if errorlevel 1 goto closed");
        cmd.AppendLine("ping -n 2 127.0.0.1 >nul");
        cmd.AppendLine("set /a WAIT+=1");
        cmd.AppendLine("if %WAIT% LSS 30 goto waitloop");
        cmd.AppendLine(":closed");

        // Останавливаем службы программы, если они заведены
        cmd.AppendLine("net stop PVSPDFService /y >nul 2>&1");
        cmd.AppendLine("sc stop PVSPDFService >nul 2>&1");
        cmd.AppendLine("net stop PVSPDFPrint /y >nul 2>&1");
        cmd.AppendLine("sc stop PVSPDFPrint >nul 2>&1");

        // Снимаем оставшиеся процессы программы и её просмотрщика
        cmd.AppendLine("taskkill /F /IM PVSPDF.exe /T >nul 2>&1");
        cmd.AppendLine("ping -n 2 127.0.0.1 >nul");

        // Тихая установка новой версии
        cmd.AppendLine($"start \"\" /wait \"{setupPath}\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS /SP-");
        cmd.AppendLine("set CODE=%ERRORLEVEL%");

        // Запускаем обновлённую программу
        cmd.AppendLine("ping -n 2 127.0.0.1 >nul");
        cmd.AppendLine($"if exist \"{exe}\" start \"\" \"{exe}\"");

        // Убираем за собой
        cmd.AppendLine($"del /f /q \"{setupPath}\" >nul 2>&1");
        cmd.AppendLine("(goto) 2>nul & del \"%~f0\"");

        File.WriteAllText(script, cmd.ToString(), new UTF8Encoding(false));

        // Запускаем отдельным процессом: помощник продолжит работу,
        // даже когда сама программа закроется
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c start \"PVSPDF\" /min cmd /c \"{script}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = dir,
        });
    }

    public static CancellationTokenSource Begin()
    {
        _cancel = new CancellationTokenSource();
        return _cancel;
    }

    public static void End()
    {
        try { _cancel?.Dispose(); } catch { }
        _cancel = null;
    }

    static void CleanOld(string dir)
    {
        try
        {
            foreach (string f in Directory.GetFiles(dir))
            {
                try { File.Delete(f); } catch { }
            }
        }
        catch { }
    }

    static string Safe(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            if (char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_') sb.Append(c);
        }
        return sb.Length > 0 ? sb.ToString() : "new";
    }
}