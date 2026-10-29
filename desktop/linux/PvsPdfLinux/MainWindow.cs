using System.Text.Json;
using Photino.NET;

namespace PvsPdfLinux;

// Главное окно Linux-версии. Понимает те же команды интерфейса, что
// и Windows-программа (desktop/csharp/PvsPdfApp/MainForm.cs), поэтому
// интерфейс в обеих версиях один и тот же
internal sealed class MainWindow
{
    readonly PhotinoWindow _win;
    readonly LocalServer _server;
    readonly List<string> _pending = new();
    readonly DateTime _startedAt = DateTime.UtcNow;

    bool _ready;
    bool _unsaved;
    string _unsavedNames = "";
    bool _closeConfirmed;
    bool _maximized;
    CancellationTokenSource? _scanCancel;

    public MainWindow(string[] openFiles)
    {
        _pending.AddRange(openFiles);

        Directory.CreateDirectory(Paths.OpenDir);
        _ = Task.Run(CleanOpenDir);

        _server = new LocalServer(Paths.WebRoot, ConfigScript);
        _server.Start();

        string icon = Path.Combine(Paths.AppDir, "pvspdf.png");

        _win = new PhotinoWindow()
            .SetTitle("ПВ-Система PDF")
            .SetUseOsDefaultSize(false)
            .SetSize(1280, 860)
            .SetMinSize(900, 600)
            .Center()
            .SetResizable(true)
            .SetContextMenuEnabled(false)
            .SetDevToolsEnabled(Environment.GetEnvironmentVariable("PVSPDF_DEVTOOLS") == "1")
            .SetGrantBrowserPermissions(true)
            .SetTemporaryFilesPath(Path.Combine(Paths.DataDir, "webview"))
            .RegisterWebMessageReceivedHandler(OnMessage)
            .RegisterWindowClosingHandler(OnClosing)
            .Load(new Uri(_server.Origin + "/index.html"));

        if (File.Exists(icon)) _win.SetIconFile(icon);

        Dialogs.Window = _win;
    }

    public void Run()
    {
        SingleInstance.Listen(paths => OnMainThread(() =>
        {
            if (_win.Minimized) _win.SetMinimized(false);
            foreach (string p in paths) SendFile(p);
        }));

        _win.WaitForClose();
        _server.Dispose();
    }

    // Сведения о программе для интерфейса — то же, что Windows-версия
    // кладёт в страницу при запуске
    string ConfigScript()
    {
        return
            "window.PVSPDF_DESKTOP = true;" +
            "window.PVSPDF_PLATFORM = 'linux';" +
            "window.PVSPDF_PACKAGE = " + JsonSerializer.Serialize(Paths.PackageKind()) + ";" +
            "window.PVSPDF_VERSION = " + JsonSerializer.Serialize(Paths.Version()) + ";" +
            "window.PVSPDF_PRINTER = " + JsonSerializer.Serialize(Settings.Printer ?? "") + ";" +
            "window.PVSPDF_PRINTERS = window.PVSPDF_PRINTERS || [];" +
            "window.PVSPDF_FULL = " + (License.IsFull() ? "true" : "false") + ";" +
            "window.PVSPDF_LIC = " + JsonSerializer.Serialize(new
            {
                org = License.Org,
                key = License.Key,
                until = License.Until,
                machine = License.MachineId(),
                machineName = License.MachineName(),
            }) + ";";
    }

    void OnMainThread(Action a)
    {
        try { _win.Invoke(a); } catch (Exception ex) { AppLog.Warn("окно", "Invoke: " + ex.Message); }
    }

    // Ответ странице. Можно звать из любого потока
    void Post(object payload)
    {
        string json = JsonSerializer.Serialize(payload);
        OnMainThread(() =>
        {
            try { _win.SendWebMessage(json); } catch { }
        });
    }

    // Последняя застава перед потерей работы
    bool OnClosing(object sender, EventArgs e)
    {
        if (_closeConfirmed || !_unsaved) return false;

        string what = string.IsNullOrWhiteSpace(_unsavedNames)
            ? "В открытых документах есть изменения, которых нет в файлах."
            : "Не сохранены изменения в документах:\n\n" + _unsavedNames;

        bool close = _win.ShowMessage("ПВ-Система PDF",
            what + "\n\nЗакрыть программу и потерять эти изменения?",
            PhotinoDialogButtons.YesNo, PhotinoDialogIcon.Warning) == PhotinoDialogResult.Yes;
        return !close;
    }

    void OnMessage(object? sender, string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            string type = Str(root, "type");

            switch (type)
            {
                case "__ready":
                    _ready = true;
                    foreach (string f in _pending) SendFile(f);
                    _pending.Clear();
                    SendPrinters();
                    break;

                case "setTitle":
                    _win.SetTitle(Str(root, "title", "ПВ-Система PDF"));
                    break;

                case "unsaved":
                    _unsaved = root.TryGetProperty("dirty", out var d) && d.ValueKind == JsonValueKind.True;
                    _unsavedNames = Str(root, "names");
                    break;

                case "close":
                    _closeConfirmed = true;
                    _win.Close();
                    break;

                case "minimize":
                    _win.SetMinimized(true);
                    break;

                case "toggleMax":
                    _maximized = !_win.Maximized;
                    _win.SetMaximized(_maximized);
                    break;

                case "openExternal":
                    OpenExternal(Str(root, "url"));
                    break;

                case "print":
                    {
                        string data = Str(root, "data");
                        string name = Str(root, "name", "document.pdf");
                        string printer = Str(root, "printer");
                        string duplex = Str(root, "duplex", "off");
                        double pw = root.TryGetProperty("paperW", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetDouble() : 0;
                        double ph = root.TryGetProperty("paperH", out var h) && h.ValueKind == JsonValueKind.Number ? h.GetDouble() : 0;
                        _ = Task.Run(() => PrintPdf(data, name, printer, duplex, pw, ph));
                        break;
                    }

                case "printerSetup":
                    try { Printing.OpenSetup(Str(root, "printer")); }
                    catch (Exception ex) { AppLog.Warn("печать", "Настройки принтера: " + ex.Message); }
                    break;

                case "openPath":
                    {
                        string p = Str(root, "path");
                        if (p.Length > 0 && File.Exists(p)) SendFile(p);
                        else Post(new { type = "openFileMissing", path = p });
                        break;
                    }

                case "rememberPath":
                    // Путь к файлу, выбранному в окне браузера, встроенный
                    // браузер Linux не сообщает — недавние документы
                    // запоминаются при открытии через программу
                    break;

                case "saveFile":
                    {
                        string data = Str(root, "data");
                        string name = Str(root, "name", "document.pdf");
                        _ = Task.Run(() => SaveFile(data, name));
                        break;
                    }

                case "saveFiles":
                    {
                        var items = new List<(string Name, string Data)>();
                        foreach (var it in root.GetProperty("files").EnumerateArray())
                            items.Add((Str(it, "name", "file"), Str(it, "data")));
                        _ = Task.Run(() => SaveMany(items));
                        break;
                    }

                case "installUpdate":
                    _ = InstallUpdateAsync(Str(root, "url"), Str(root, "version"));
                    break;

                case "cancelUpdate":
                    Updater.Stop();
                    break;

                case "listScanners":
                    _ = Task.Run(ListScanners);
                    break;

                case "addScanner":
                    ManualScanners.Add(new ManualScanners.Item
                    {
                        Name = Str(root, "name").Trim(),
                        Feeder = Bool(root, "feeder"),
                        Duplex = Bool(root, "duplex"),
                    });
                    _ = Task.Run(ListScanners);
                    break;

                case "removeScanner":
                    ManualScanners.Remove(Str(root, "name"));
                    _ = Task.Run(ListScanners);
                    break;

                case "chooseScanner":
                    // Окна выбора от драйвера в Linux нет — просто
                    // опрашиваем систему ещё раз
                    _ = Task.Run(() =>
                    {
                        var list = Scanner.List();
                        var first = list.FirstOrDefault(x => !x.Manual);
                        Post(first != null
                            ? new { type = "scannerChosen", ok = true, name = first.Name, steps = "" }
                            : new { type = "scannerChosen", ok = false, name = "", steps = Scanner.Diagnose() });
                        ListScanners();
                    });
                    break;

                case "scanSelfTest":
                    _ = Task.Run(ScanSelfTest);
                    break;

                case "openScanSetup":
                    OpenScanSetup(Str(root, "path"));
                    break;

                case "scanCaps":
                    {
                        string dev = Str(root, "device");
                        _ = Task.Run(() => Post(new { type = "scanCaps", device = dev, dpi = Scanner.Resolutions(dev) }));
                        break;
                    }

                case "scan":
                    {
                        var opt = new Scanner.Options
                        {
                            DeviceId = Str(root, "device"),
                            Dpi = root.TryGetProperty("dpi", out var dp) && dp.TryGetInt32(out int dpi) ? dpi : 300,
                            Color = Str(root, "color", "color"),
                            Feeder = Bool(root, "feeder"),
                            Duplex = Bool(root, "duplex"),
                            Limit = root.TryGetProperty("limit", out var lm) && lm.TryGetInt32(out int lim) ? lim : 0,
                        };
                        _ = Task.Run(() => Scan(opt));
                        break;
                    }

                case "scanDriverUi":
                    OpenDriverUi();
                    break;

                case "cancelScan":
                    try { _scanCancel?.Cancel(); } catch { }
                    break;

                case "licenseSave":
                    {
                        bool ok = License.Save(Str(root, "payload"), Str(root, "sig"));
                        Post(new
                        {
                            type = "licenseState",
                            full = License.IsFull(),
                            accepted = ok,
                            org = License.Org,
                            key = License.Key,
                            until = License.Until,
                        });
                        break;
                    }

                case "licenseClear":
                    License.Clear();
                    Post(new { type = "licenseState", full = false, accepted = true, org = "", key = "", until = "" });
                    break;

                case "log":
                    {
                        string area = Str(root, "area", "интерфейс");
                        string msg = Str(root, "message");
                        if (msg.Length > 4000) msg = msg[..4000] + "…";
                        if (Str(root, "level") == "warn") AppLog.Warn(area, msg);
                        else AppLog.Error(area, msg);
                        break;
                    }

                case "openLogs":
                    AppLog.OpenFolder();
                    break;
            }
        }
        catch (Exception ex)
        {
            AppLog.Error("команда", "Сбой при обработке команды интерфейса", ex);
        }
    }

    static string Str(JsonElement e, string name, string def = "") =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? def) : def;

    static bool Bool(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    // ---------- Документы ----------

    void SendFile(string path)
    {
        if (!_ready)
        {
            _pending.Add(path);
            return;
        }

        try
        {
            string full = Path.GetFullPath(path);
            long size = 0;
            try { size = new FileInfo(full).Length; } catch { }

            Post(new
            {
                type = "openFile",
                name = Path.GetFileName(full),
                size,
                url = _server.ShareFile(full),
                path = full,
            });
        }
        catch (Exception ex)
        {
            AppLog.Error("открытие", "Не удалось открыть файл: " + path, ex);
            Dialogs.Warn("Не удалось открыть файл:\n" + ex.Message);
        }
    }

    void CleanOpenDir()
    {
        try
        {
            foreach (string d in Directory.GetDirectories(Paths.OpenDir))
            {
                try { if (Directory.GetCreationTimeUtc(d) < _startedAt) Directory.Delete(d, true); } catch { }
            }
            foreach (string f in Directory.GetFiles(Paths.OpenDir))
            {
                try { if (File.GetCreationTimeUtc(f) < _startedAt) File.Delete(f); } catch { }
            }
        }
        catch { }
    }

    static string SafeName(string name, string def)
    {
        string safe = string.Concat(name.Split(Path.GetInvalidFileNameChars()));
        return string.IsNullOrWhiteSpace(safe) ? def : safe;
    }

    void SaveFile(string base64, string fileName)
    {
        try
        {
            byte[] bytes = Convert.FromBase64String(base64);
            string safe = SafeName(fileName, "document.pdf");
            string ext = Path.GetExtension(safe).TrimStart('.').ToLowerInvariant();
            if (ext.Length == 0) { ext = "pdf"; safe += ".pdf"; }

            string filter = ext switch
            {
                "pdf" => "Документ PDF",
                "docx" or "doc" => "Документ Word",
                "xlsx" or "xls" => "Таблица Excel",
                "txt" => "Текстовый файл",
                "jpg" or "jpeg" => "Изображение JPEG",
                "png" => "Изображение PNG",
                "zip" => "Архив ZIP",
                "html" => "Страница HTML",
                _ => "Файл " + ext.ToUpperInvariant(),
            };

            string? path = Dialogs.SaveFile(safe, ext, filter);
            if (path == null)
            {
                Post(new { type = "saveDone", ok = false, cancelled = true });
                return;
            }

            File.WriteAllBytes(path, bytes);
            Post(new { type = "saveDone", ok = true, path, name = Path.GetFileName(path) });
        }
        catch (Exception ex)
        {
            AppLog.Error("сохранение", "Не удалось сохранить файл", ex);
            Post(new { type = "saveDone", ok = false, error = ex.Message });
            Dialogs.Warn("Не удалось сохранить файл.\n\n" + ex.Message);
        }
    }

    void SaveMany(List<(string Name, string Data)> files)
    {
        try
        {
            string? dir = Dialogs.PickFolder("Выберите папку для сохранения файлов");
            if (dir == null)
            {
                Post(new { type = "saveDone", ok = false, cancelled = true });
                return;
            }

            foreach (var f in files)
            {
                string safe = SafeName(f.Name, "");
                if (safe.Length == 0) continue;
                File.WriteAllBytes(Path.Combine(dir, safe), Convert.FromBase64String(f.Data));
            }
            Post(new { type = "saveDone", ok = true, path = dir, count = files.Count });
        }
        catch (Exception ex)
        {
            AppLog.Error("сохранение", "Не удалось сохранить файлы", ex);
            Post(new { type = "saveDone", ok = false, error = ex.Message });
            Dialogs.Warn("Не удалось сохранить файлы.\n\n" + ex.Message);
        }
    }

    // ---------- Печать ----------

    void SendPrinters()
    {
        _ = Task.Run(() => Post(new { type = "__printers", list = Printing.List() }));
    }

    void PrintPdf(string base64, string fileName, string printer, string duplex = "off", double paperW = 0, double paperH = 0)
    {
        string dir = Path.Combine(Path.GetTempPath(), "pvspdf-print-" + Paths.Uid());
        try
        {
            Directory.CreateDirectory(dir);
            foreach (string old in Directory.GetFiles(dir))
            {
                try { if (File.GetLastWriteTimeUtc(old) < DateTime.UtcNow.AddHours(-6)) File.Delete(old); } catch { }
            }

            string safe = SafeName(fileName, "document.pdf");
            if (!safe.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) safe += ".pdf";
            string path = Path.Combine(dir, Guid.NewGuid().ToString("N") + "_" + safe);
            File.WriteAllBytes(path, Convert.FromBase64String(base64));

            string used = Printing.Print(path, printer, safe, duplex, paperW, paperH);
            if (!string.IsNullOrWhiteSpace(used)) Settings.Printer = used;
            Post(new { type = "printDone", ok = true, printer = used });
        }
        catch (Exception ex)
        {
            AppLog.Warn("печать", "Не удалось напечатать: " + ex.Message);
            Post(new { type = "printDone", ok = false, error = ex.Message });
            Dialogs.Warn("Не удалось напечатать документ.\n\n" + ex.Message);
        }
    }

    // ---------- Обновление ----------

    async Task InstallUpdateAsync(string url, string version)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            Post(new { type = "updateState", state = "error", error = "Ссылка на обновление не получена." });
            return;
        }
        if (Updater.Busy) return;

        var cts = Updater.Begin();
        Post(new { type = "updateState", state = "start" });

        try
        {
            string pkg = await Updater.DownloadAsync(url, version, (percent, got, total) =>
                Post(new { type = "updateState", state = "progress", percent, loaded = got, total }), cts.Token);

            Post(new { type = "updateState", state = "installing" });
            await Task.Run(() => Updater.Install(pkg));

            Updater.Relaunch();
            _closeConfirmed = true;
            OnMainThread(() => _win.Close());
        }
        catch (OperationCanceledException)
        {
            Post(new { type = "updateState", state = "cancelled" });
        }
        catch (Exception ex)
        {
            AppLog.Error("обновление", "Не удалось установить обновление", ex);
            Post(new { type = "updateState", state = "error", error = ex.Message });
        }
        finally
        {
            Updater.End();
        }
    }

    // ---------- Сканер ----------

    void ListScanners()
    {
        var list = Scanner.List();
        string hint = list.Count > 0 ? "" : Scanner.Diagnose();
        Post(new
        {
            type = "scanners",
            items = list.Select(d => new
            {
                id = d.Id,
                name = d.Name,
                feeder = d.HasFeeder,
                duplex = d.HasDuplex,
                twain = false,
                manual = d.Manual,
            }),
            hint,
            setups = Scanner.Setups().Select(s => new { name = s.Name, path = s.Path, main = s.Main, network = s.Network }),
            known = Scanner.Registered(),
        });
    }

    void ScanSelfTest()
    {
        string report;
        try { report = Scanner.SelfTest(); }
        catch (Exception ex) { report = "Не удалось собрать отчёт: " + ex.Message; }

        string path = Path.Combine(Paths.DataDir, "scanners-report.txt");
        try { File.WriteAllText(path, report); } catch { path = ""; }
        Post(new { type = "scanSelfTest", report, path });
    }

    void Scan(Scanner.Options opt)
    {
        if (_scanCancel != null)
        {
            Post(new { type = "scanDone", ok = false, error = "Сканирование уже идёт." });
            return;
        }

        var cts = new CancellationTokenSource();
        _scanCancel = cts;
        string dir = Path.Combine(Paths.OpenDir, "scan_" + DateTime.Now.Ticks);

        try
        {
            Post(new { type = "scanState", state = "start" });
            var files = Scanner.Scan(opt, dir,
                (n, path) => Post(new { type = "scanPage", index = n, url = _server.OpenDirUrl(path) }),
                cts.Token);

            Post(new
            {
                type = "scanDone",
                ok = true,
                pages = files.Select(_server.OpenDirUrl),
                ignored = Scanner.Ignored.ToArray(),
            });
        }
        catch (OperationCanceledException)
        {
            Post(new { type = "scanDone", ok = false, cancelled = true });
        }
        catch (Exception ex)
        {
            AppLog.Error("сканер", "Сбой сканирования", ex);
            Post(new { type = "scanDone", ok = false, error = ex.Message });
        }
        finally
        {
            _scanCancel = null;
            cts.Dispose();
        }
    }

    // «Окно драйвера» в Linux — программа сканирования из системы
    // (XSane, «Простое сканирование»). Снятое в ней человек сохраняет
    // и открывает в нашей программе обычным порядком
    void OpenDriverUi()
    {
        var setup = Scanner.Setups().FirstOrDefault(s => s.Path.EndsWith("xsane")) ?? Scanner.Setups().FirstOrDefault();
        if (setup == null)
        {
            Post(new
            {
                type = "scanDone",
                ok = false,
                error = "В системе нет отдельной программы сканирования. Установите XSane " +
                        "или «Простое сканирование» (simple-scan), либо снимайте прямо отсюда.",
            });
            return;
        }

        try
        {
            Shell.Start(setup.Path);
            Post(new
            {
                type = "scanDone",
                ok = false,
                error = "Открыта программа «" + setup.Name + "». Сохраните в ней снимок и откройте файл здесь.",
            });
        }
        catch (Exception ex)
        {
            Post(new { type = "scanDone", ok = false, error = "Не удалось открыть программу сканирования: " + ex.Message });
        }
    }

    void OpenScanSetup(string path)
    {
        var pick = Scanner.Setups().FirstOrDefault(s => s.Path == path);
        if (pick == null)
        {
            Post(new { type = "scanSetupDone", ok = false, error = "Программа не найдена." });
            return;
        }
        try
        {
            Shell.Start(pick.Path);
            Post(new { type = "scanSetupDone", ok = true, error = "" });
        }
        catch (Exception ex)
        {
            Post(new { type = "scanSetupDone", ok = false, error = "Не удалось открыть: " + ex.Message });
        }
    }

    // Внешние ссылки — только http(s), в браузере пользователя
    static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http")) return;
        try { Shell.Open(u.AbsoluteUri); }
        catch (Exception ex) { AppLog.Warn("ссылка", "Не удалось открыть ссылку: " + ex.Message); }
    }
}
