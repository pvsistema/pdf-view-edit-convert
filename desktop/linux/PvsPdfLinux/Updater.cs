using System.Diagnostics;
using System.Text;

namespace PvsPdfLinux;

// Обновление: качаем пакет .deb или .rpm с полосой загрузки, ставим его
// с правами администратора (система сама спросит пароль) и запускаем
// программу заново
internal static class Updater
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(30) };
    static CancellationTokenSource? _cancel;

    public static bool Busy => _cancel != null;

    public static CancellationTokenSource Begin() => _cancel = new CancellationTokenSource();

    public static void Stop()
    {
        try { _cancel?.Cancel(); } catch { }
    }

    public static void End()
    {
        try { _cancel?.Dispose(); } catch { }
        _cancel = null;
    }

    public static async Task<string> DownloadAsync(string url, string version, Action<int, long, long> onProgress, CancellationToken token)
    {
        string kind = Paths.PackageKind();
        string dir = Path.Combine(Path.GetTempPath(), "pvspdf-update-" + Paths.Uid());
        Directory.CreateDirectory(dir);
        foreach (string f in Directory.GetFiles(dir)) { try { File.Delete(f); } catch { } }

        string file = Path.Combine(dir, $"pvspdf-{Safe(version)}.{kind}");
        string temp = file + ".part";

        using var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        resp.EnsureSuccessStatusCode();

        long total = resp.Content.Headers.ContentLength ?? 0;
        long got = 0;
        int last = -1;

        await using (var src = await resp.Content.ReadAsStreamAsync(token))
        await using (var dst = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true))
        {
            var buf = new byte[1 << 16];
            int n;
            while ((n = await src.ReadAsync(buf, token)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, n), token);
                got += n;
                int percent = total > 0 ? (int)(got * 100 / total) : 0;
                if (percent != last || total == 0)
                {
                    last = percent;
                    onProgress(percent, got, total);
                }
            }
        }

        if (new FileInfo(temp).Length < 1024)
        {
            File.Delete(temp);
            throw new InvalidOperationException("Файл обновления получен не полностью.");
        }

        File.Move(temp, file, true);
        onProgress(100, got, total > 0 ? total : got);
        return file;
    }

    // Установка пакета. pkexec покажет системное окно ввода пароля
    // администратора — так же, как при установке любой программы
    public static void Install(string package)
    {
        string kind = package.EndsWith(".deb") ? "deb" : "rpm";
        string cmd = kind == "deb"
            ? "if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades \"$1\"; else dpkg -i \"$1\"; fi"
            : "if command -v dnf >/dev/null 2>&1; then dnf install -y \"$1\"; elif command -v yum >/dev/null 2>&1; then yum install -y \"$1\"; elif command -v apt-get >/dev/null 2>&1; then apt-get install -y \"$1\"; else rpm -Uvh --replacepkgs \"$1\"; fi";

        if (!Shell.Exists("pkexec"))
            throw new InvalidOperationException(
                "Не найдена программа запроса прав администратора (pkexec, пакет polkit). " +
                "Установите обновление вручную: " + package);

        var r = Shell.Run("pkexec", new[] { "/bin/sh", "-c", cmd, "pvspdf-update", package }, 15 * 60 * 1000);
        if (r.Code == 126 || r.Code == 127)
            throw new OperationCanceledException("Установка отменена.");
        if (r.Code != 0)
        {
            AppLog.Error("обновление", "Установка пакета: " + (r.Err + r.Out).Trim());
            string tail = (r.Err.Trim().Length > 0 ? r.Err : r.Out).Trim();
            if (tail.Length > 400) tail = tail[^400..];
            throw new InvalidOperationException("Пакет не установился. " + tail);
        }
    }

    // Новая копия программы стартует через пару секунд — когда эта
    // уже закроется и освободит место единственного экземпляра
    public static void Relaunch()
    {
        string exe = Path.Combine(Paths.AppDir, "pvspdf");
        var psi = new ProcessStartInfo
        {
            FileName = "/bin/sh",
            UseShellExecute = false,
        };
        psi.ArgumentList.Add("-c");
        psi.ArgumentList.Add("sleep 2; exec \"$0\"");
        psi.ArgumentList.Add(File.Exists("/usr/bin/pvspdf") ? "/usr/bin/pvspdf" : exe);
        Process.Start(psi);
    }

    static string Safe(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in s) if (char.IsLetterOrDigit(c) || c is '.' or '-' or '_') sb.Append(c);
        return sb.Length > 0 ? sb.ToString() : "new";
    }
}