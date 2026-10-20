using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace PvsPdfLinux;

// Небольшой веб-сервер только для этого компьютера (127.0.0.1).
//
// Зачем. В Windows-версии файлы интерфейса и документы отдаёт сам
// встроенный просмотрщик. Встроенному браузеру Linux (WebKitGTK) нужен
// адрес, который он считает защищённым — иначе не работают шифрование
// платного модуля и фоновые обработчики. Адрес 127.0.0.1 он защищённым
// считает. Порт постоянный: от адреса зависит сохранённое состояние
// интерфейса (недавние документы, настройки)
internal sealed class LocalServer : IDisposable
{
    readonly HttpListener _http = new();
    readonly string _webRoot;
    readonly Func<string> _configScript;

    // Открытые документы отдаются по секретному адресу: другой
    // пользователь этого компьютера не сможет их прочитать
    readonly string _secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    readonly ConcurrentDictionary<string, string> _docs = new();

    public int Port { get; private set; }
    public string Origin => $"http://127.0.0.1:{Port}";

    public LocalServer(string webRoot, Func<string> configScript)
    {
        _webRoot = Path.GetFullPath(webRoot);
        _configScript = configScript;
    }

    public void Start()
    {
        // Порт выбираем от номера пользователя: у каждого свой, и при
        // каждом запуске тот же самый
        int basePort = 47100 + (int)(Paths.Uid() % 800);
        for (int i = 0; i < 20; i++)
        {
            int port = basePort + i * 800;
            if (!IsFree(port)) continue;
            try
            {
                _http.Prefixes.Clear();
                _http.Prefixes.Add($"http://127.0.0.1:{port}/");
                _http.Start();
                Port = port;
                break;
            }
            catch { }
        }
        if (Port == 0) throw new InvalidOperationException("Не удалось занять порт для окна программы");

        _ = Task.Run(LoopAsync);
    }

    static bool IsFree(int port)
    {
        try
        {
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch { return false; }
    }

    // Адрес, по которому интерфейс прочитает документ с диска. Файл не
    // копируется: просмотрщик читает его по частям прямо с места
    public string ShareFile(string path)
    {
        string id = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        _docs[id] = Path.GetFullPath(path);
        return $"{Origin}/open/{_secret}/d/{id}/{Uri.EscapeDataString(Path.GetFileName(path))}";
    }

    // Файл из папки открытых документов (снимки сканера)
    public string OpenDirUrl(string path)
    {
        string rel = Path.GetRelativePath(Paths.OpenDir, path).Replace('\\', '/');
        return $"{Origin}/open/{_secret}/f/" + string.Join('/', rel.Split('/').Select(Uri.EscapeDataString));
    }

    async Task LoopAsync()
    {
        while (_http.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = await _http.GetContextAsync(); }
            catch { break; }
            _ = Task.Run(() => Handle(ctx));
        }
    }

    void Handle(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        try
        {
            // Только этот компьютер
            if (!IPAddress.IsLoopback(req.RemoteEndPoint.Address))
            {
                res.StatusCode = 403;
                return;
            }

            res.Headers["Cache-Control"] = "no-cache";
            res.Headers["X-Content-Type-Options"] = "nosniff";

            string path = Uri.UnescapeDataString(req.Url?.AbsolutePath ?? "/");

            if (path.StartsWith("/open/"))
            {
                ServeOpen(path, req, res);
                return;
            }

            if (path == "/" || path == "") path = "/index.html";

            string file = Path.GetFullPath(Path.Combine(_webRoot, path.TrimStart('/')));
            if (!file.StartsWith(_webRoot + Path.DirectorySeparatorChar) || !File.Exists(file))
            {
                // Адреса страниц интерфейса — отдаём его главную страницу
                if (!Path.HasExtension(path)) file = Path.Combine(_webRoot, "index.html");
                else { res.StatusCode = 404; return; }
            }

            if (file.EndsWith("index.html"))
            {
                ServeIndex(file, res);
                return;
            }

            // Обработчик просмотрщика работает в отдельном потоке, куда
            // подпорки страницы не доходят — добавляем их в начало файла
            string name = Path.GetFileName(file);
            if (name.StartsWith("pdf.worker") && name.EndsWith(".mjs"))
            {
                byte[] body = Encoding.UTF8.GetBytes(Polyfills.Script + "\n" + File.ReadAllText(file));
                res.ContentType = "text/javascript; charset=utf-8";
                res.ContentLength64 = body.Length;
                res.OutputStream.Write(body);
                return;
            }

            ServeFile(file, req, res);
        }
        catch (Exception ex)
        {
            try { res.StatusCode = 500; } catch { }
            AppLog.Warn("сервер", "Сбой при отдаче файла: " + ex.Message);
        }
        finally
        {
            try { res.Close(); } catch { }
        }
    }

    void ServeIndex(string file, HttpListenerResponse res)
    {
        // Сведения о программе и подпорки для старых версий WebKit
        // попадают в страницу раньше всех её скриптов
        string html = File.ReadAllText(file);
        string inject = "<script>" + Polyfills.Script + "\n" + _configScript() + "</script>";
        int at = html.IndexOf("<head>", StringComparison.OrdinalIgnoreCase);
        html = at >= 0 ? html.Insert(at + 6, inject) : inject + html;

        byte[] body = Encoding.UTF8.GetBytes(html);
        res.ContentType = "text/html; charset=utf-8";
        res.ContentLength64 = body.Length;
        res.OutputStream.Write(body);
    }

    void ServeOpen(string path, HttpListenerRequest req, HttpListenerResponse res)
    {
        // /open/<секрет>/d/<номер>/<имя>  — документ с диска
        // /open/<секрет>/f/<путь>         — файл из папки открытых документов
        string[] parts = path.Split('/', 5, StringSplitOptions.None);
        if (parts.Length < 5 || !CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(parts[2]), Encoding.ASCII.GetBytes(_secret)))
        {
            res.StatusCode = 404;
            return;
        }

        string? file = null;
        if (parts[3] == "d")
        {
            string id = parts[4].Split('/')[0];
            _docs.TryGetValue(id, out file);
        }
        else if (parts[3] == "f")
        {
            string root = Path.GetFullPath(Paths.OpenDir);
            string full = Path.GetFullPath(Path.Combine(root, parts[4]));
            if (full.StartsWith(root + Path.DirectorySeparatorChar)) file = full;
        }

        if (file == null || !File.Exists(file))
        {
            res.StatusCode = 404;
            return;
        }
        ServeFile(file, req, res);
    }

    // Отдача файла с поддержкой чтения по частям: большой PDF
    // просмотрщик читает только с тех страниц, что на экране
    static void ServeFile(string file, HttpListenerRequest req, HttpListenerResponse res)
    {
        using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);
        long length = fs.Length;
        long start = 0, end = length - 1;

        res.ContentType = Mime(file);
        res.Headers["Accept-Ranges"] = "bytes";

        string? range = req.Headers["Range"];
        if (!string.IsNullOrEmpty(range) && range.StartsWith("bytes=") && length > 0)
        {
            string spec = range.Substring(6).Split(',')[0].Trim();
            string[] se = spec.Split('-');
            if (se[0].Length == 0 && long.TryParse(se[1], out long suffix))
            {
                start = Math.Max(0, length - suffix);
            }
            else
            {
                long.TryParse(se[0], out start);
                if (se.Length > 1 && long.TryParse(se[1], out long e)) end = Math.Min(e, length - 1);
            }

            if (start > end || start >= length)
            {
                res.StatusCode = 416;
                res.Headers["Content-Range"] = $"bytes */{length}";
                return;
            }

            res.StatusCode = 206;
            res.Headers["Content-Range"] = $"bytes {start}-{end}/{length}";
        }

        long count = length == 0 ? 0 : end - start + 1;
        res.ContentLength64 = count;
        if (req.HttpMethod == "HEAD" || count == 0) return;

        fs.Seek(start, SeekOrigin.Begin);
        byte[] buf = new byte[1 << 16];
        while (count > 0)
        {
            int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, count));
            if (n <= 0) break;
            res.OutputStream.Write(buf, 0, n);
            count -= n;
        }
    }

    static string Mime(string file) => Path.GetExtension(file).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" or ".map" => "application/json",
        ".webmanifest" => "application/manifest+json",
        ".wasm" => "application/wasm",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".tif" or ".tiff" => "image/tiff",
        ".ttf" => "font/ttf",
        ".otf" => "font/otf",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".pdf" => "application/pdf",
        ".txt" or ".aff" or ".dic" => "text/plain; charset=utf-8",
        ".gz" => "application/gzip",
        _ => "application/octet-stream",
    };

    public void Dispose()
    {
        try { _http.Stop(); _http.Close(); } catch { }
    }
}