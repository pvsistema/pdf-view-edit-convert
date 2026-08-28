using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PvsPdfApp;

public class MainForm : Form
{
    readonly WebView2 _web = new();
    readonly string[] _openFiles;
    readonly DateTime _startedAt = DateTime.UtcNow;
    string _webRoot = "";
    string _openDir = "";
    CancellationTokenSource? _scanCancel;

    public MainForm(string[]? openFiles = null)
    {
        _openFiles = openFiles ?? Array.Empty<string>();

        Text = "ПВ-Система PDF";
        Width = 1280;
        Height = 860;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = ColorTranslator.FromHtml("#F7F6F2");

        try
        {
            string ico = Path.Combine(AppContext.BaseDirectory, "pvspdf.ico");
            if (File.Exists(ico)) Icon = new Icon(ico);
        }
        catch { }

        _web.Dock = DockStyle.Fill;
        _web.DefaultBackgroundColor = ColorTranslator.FromHtml("#F7F6F2");
        Controls.Add(_web);

        Load += async (s, e) => await StartAsync();
    }

    async Task StartAsync()
    {
        _webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        if (!File.Exists(Path.Combine(_webRoot, "index.html")))
        {
            MessageBox.Show(
                "Не найдены файлы интерфейса программы (папка web).\r\n" +
                "Переустановите ПВ-Система PDF.",
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        string dataDir = Path.Combine(Program.InstallDir, "data");
        Directory.CreateDirectory(dataDir);

        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Не удалось запустить встроенный просмотрщик.\r\n\r\n" +
                "Установите компонент Microsoft Edge WebView2 Runtime:\r\n" +
                "https://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\n" +
                ex.Message,
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = _web.CoreWebView2;

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;

        // Локальные файлы интерфейса отдаются как https://pvspdf.local/
        core.SetVirtualHostNameToFolderMapping(
            "pvspdf.local", _webRoot, CoreWebView2HostResourceAccessKind.Allow);

        // Открываемые документы отдаются как https://pvspdf.file/ — программа
        // читает их напрямую, без перекодирования: большой файл открывается
        // в разы быстрее и не занимает лишнюю память
        _openDir = Path.Combine(Program.InstallDir, "open");
        Directory.CreateDirectory(_openDir);
        core.SetVirtualHostNameToFolderMapping(
            "pvspdf.file", _openDir, CoreWebView2HostResourceAccessKind.Allow);

        // Прошлые документы удаляем в фоне: на медленном диске перебор папки
        // задерживал появление окна
        _ = Task.Run(CleanOpenDir);

        // Открывать внешние ссылки в системном браузере
        core.NewWindowRequested += (s, e) =>
        {
            e.Handled = true;
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = e.Uri,
                    UseShellExecute = true
                });
            }
            catch { }
        };

        core.WebMessageReceived += OnWebMessage;

        // Сообщаем странице, что она работает в десктопной версии.
        // Список принтеров сюда не кладём: опрос сетевых принтеров
        // занимает секунды и задерживал бы запуск программы
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "window.PVSPDF_DESKTOP = true;" +
            "window.PVSPDF_VERSION = '" + AppVersion() + "';" +
            "window.PVSPDF_PRINTER = " + JsonSerializer.Serialize(Settings.Printer ?? "") + ";" +
            "window.PVSPDF_PRINTERS = [];" +
            // Решение о полной версии принимает программа, а не страница:
            // подделать его правкой памяти браузера нельзя
            "window.PVSPDF_FULL = " + (License.IsFull() ? "true" : "false") + ";" +
            "window.PVSPDF_LIC = " + JsonSerializer.Serialize(new
            {
                org = License.Org,
                key = License.Key,
                until = License.Until,
                machine = License.MachineId(),
                machineName = License.MachineName(),
            }) + ";");

        core.Navigate("https://pvspdf.local/index.html");

        core.NavigationCompleted += async (s, e) =>
        {
            if (_openFiles.Length > 0)
            {
                // Небольшая пауза: интерфейс должен успеть подготовиться
                // к приёму документов
                await Task.Delay(150);
                foreach (string f in _openFiles) await SendFileAsync(f);
            }
            SendPrintersAsync();
        };

        StartPipeListener();
    }

    // Принимаем файлы от повторных запусков программы:
    // документ откроется в этом окне вместо сообщения "уже запущена"
    void StartPipeListener()
    {
        _ = Task.Run(async () =>
        {
            while (!IsDisposed)
            {
                try
                {
                    using var pipe = new System.IO.Pipes.NamedPipeServerStream(
                        Program.PipeName, System.IO.Pipes.PipeDirection.In);
                    await pipe.WaitForConnectionAsync();

                    using var reader = new StreamReader(pipe, System.Text.Encoding.UTF8);
                    string payload = (await reader.ReadToEndAsync()).Trim();
                    string[] paths = payload
                        .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                        .Select(p => p.Trim())
                        .Where(File.Exists)
                        .ToArray();

                    BeginInvoke(new Action(async () =>
                    {
                        if (WindowState == FormWindowState.Minimized)
                            WindowState = FormWindowState.Normal;
                        Activate();
                        BringToFront();

                        // Каждый документ откроется своей вкладкой
                        foreach (string p in paths) await SendFileAsync(p);
                    }));
                }
                catch
                {
                    await Task.Delay(500);
                }
            }
        });
    }

    // Принтеры ищем в фоне, чтобы окно открывалось сразу.
    // Готовый список передаём в интерфейс отдельным сообщением
    void SendPrintersAsync()
    {
        _ = Task.Run(() =>
        {
            string json = JsonSerializer.Serialize(PrinterList());
            try
            {
                BeginInvoke(new Action(() =>
                {
                    try
                    {
                        _web.CoreWebView2?.ExecuteScriptAsync(
                            "window.PVSPDF_PRINTERS = " + json + ";" +
                            "window.dispatchEvent(new CustomEvent('pvspdf-printers'));");
                    }
                    catch { }
                }));
            }
            catch { }
        });
    }

    // Список принтеров, установленных в Windows.
    // Первым идёт принтер по умолчанию
    static string[] PrinterList()
    {
        try
        {
            var all = System.Drawing.Printing.PrinterSettings.InstalledPrinters
                .Cast<string>()
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Distinct()
                .ToList();

            string def = "";
            try { def = new System.Drawing.Printing.PrinterSettings().PrinterName ?? ""; } catch { }

            return all
                .OrderByDescending(p => string.Equals(p, def, StringComparison.OrdinalIgnoreCase))
                .ThenBy(p => p)
                .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    static string AppVersion()
    {
        try
        {
            string f = Path.Combine(AppContext.BaseDirectory, "app_version.txt");
            if (File.Exists(f)) return File.ReadAllText(f).Trim();
        }
        catch { }
        return "1.0.0";
    }

    // Убираем документы, оставшиеся от прошлых запусков.
    // Файлы текущего сеанса не трогаем: их мог только что открыть пользователь
    void CleanOpenDir()
    {
        DateTime started = _startedAt;
        try
        {
            foreach (string f in Directory.GetFiles(_openDir))
            {
                try
                {
                    if (File.GetCreationTimeUtc(f) >= started) continue;
                    File.Delete(f);
                }
                catch { }
            }

            // Снимки сканера лежат в отдельных папках — убираем те,
            // что остались от прошлых запусков, чтобы диск не забивался
            foreach (string d in Directory.GetDirectories(_openDir))
            {
                try
                {
                    if (Directory.GetCreationTimeUtc(d) >= started) continue;
                    Directory.Delete(d, true);
                }
                catch { }
            }
        }
        catch { }
    }

    async Task SendFileAsync(string path)
    {
        try
        {
            // Документ становится доступен интерфейсу по адресу и читается
            // по частям: просмотрщик берёт только нужные страницы
            string name = Path.GetFileName(path);
            string temp = Path.Combine(_openDir, "doc_" + DateTime.Now.Ticks + ".pdf");

            // Если документ лежит на том же диске, делаем на него ссылку:
            // копирование не нужно, и файл на сотни мегабайт открывается сразу
            if (!NativeMethods.CreateHardLink(temp, path, IntPtr.Zero))
            {
                using var src = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 20, true);
                using var dst = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20, true);
                await src.CopyToAsync(dst);
            }

            long size = 0;
            try { size = new FileInfo(temp).Length; } catch { }

            var msg = new
            {
                type = "openFile",
                name,
                size,
                url = "https://pvspdf.file/" + Path.GetFileName(temp)
            };
            _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(msg));
        }
        catch (Exception ex)
        {
            MessageBox.Show("Не удалось открыть файл:\r\n" + ex.Message,
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            string type = root.GetProperty("type").GetString() ?? "";

            if (type == "setTitle")
            {
                string t = root.GetProperty("title").GetString() ?? "ПВ-Система PDF";
                Text = t;
            }
            else if (type == "close")
            {
                Close();
            }
            else if (type == "minimize")
            {
                WindowState = FormWindowState.Minimized;
            }
            else if (type == "toggleMax")
            {
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal
                    : FormWindowState.Maximized;
            }
            else if (type == "print")
            {
                string b64 = root.GetProperty("data").GetString() ?? "";
                string fileName = root.TryGetProperty("name", out var n)
                    ? (n.GetString() ?? "document.pdf")
                    : "document.pdf";
                string printer = root.TryGetProperty("printer", out var pr)
                    ? (pr.GetString() ?? "")
                    : "";
                _ = PrintPdfAsync(b64, fileName, printer);
            }
            else if (type == "printerSetup")
            {
                string p = root.TryGetProperty("printer", out var pn)
                    ? (pn.GetString() ?? "")
                    : "";
                OpenPrinterSetup(p);
            }
            else if (type == "saveFiles")
            {
                var items = new List<(string Name, string Data)>();
                foreach (var it in root.GetProperty("files").EnumerateArray())
                {
                    items.Add((
                        it.GetProperty("name").GetString() ?? "file",
                        it.GetProperty("data").GetString() ?? ""));
                }
                _ = SaveManyAsync(items);
            }
            else if (type == "saveFile")
            {
                string b64 = root.GetProperty("data").GetString() ?? "";
                string fileName = root.TryGetProperty("name", out var n)
                    ? (n.GetString() ?? "document.pdf")
                    : "document.pdf";
                _ = SaveFileAsync(b64, fileName);
            }
            else if (type == "installUpdate")
            {
                string url = root.TryGetProperty("url", out var u) ? (u.GetString() ?? "") : "";
                string ver = root.TryGetProperty("version", out var v) ? (v.GetString() ?? "") : "";
                _ = InstallUpdateAsync(url, ver);
            }
            else if (type == "cancelUpdate")
            {
                Updater.Stop();
            }
            else if (type == "listScanners")
            {
                _ = ListScannersAsync();
            }
            else if (type == "scan")
            {
                var opt = new Scanner.Options
                {
                    DeviceId = root.TryGetProperty("device", out var dv) ? (dv.GetString() ?? "") : "",
                    Dpi = root.TryGetProperty("dpi", out var dp) ? dp.GetInt32() : 300,
                    Color = root.TryGetProperty("color", out var cl) ? (cl.GetString() ?? "color") : "color",
                    Feeder = root.TryGetProperty("feeder", out var fd) && fd.GetBoolean(),
                    Duplex = root.TryGetProperty("duplex", out var dx) && dx.GetBoolean(),
                    Limit = root.TryGetProperty("limit", out var lm) ? lm.GetInt32() : 0,
                };

                // Устройству от производителя нужно имя, а не системный код
                if (opt.DeviceId.StartsWith("twain:"))
                {
                    opt.Twain = true;
                    opt.DeviceName = opt.DeviceId.Substring(6);
                }

                _ = ScanAsync(opt);
            }
            else if (type == "cancelScan")
            {
                try { _scanCancel?.Cancel(); } catch { }
            }
            else if (type == "licenseSave")
            {
                // Ответ сервера принимаем только с верной подписью
                string payload = root.TryGetProperty("payload", out var pl) ? (pl.GetString() ?? "") : "";
                string sig = root.TryGetProperty("sig", out var sg) ? (sg.GetString() ?? "") : "";
                bool ok = License.Save(payload, sig);
                SendUpdate(new
                {
                    type = "licenseState",
                    full = License.IsFull(),
                    accepted = ok,
                    org = License.Org,
                    key = License.Key,
                    until = License.Until,
                });
            }
            else if (type == "licenseClear")
            {
                License.Clear();
                SendUpdate(new { type = "licenseState", full = false, accepted = true, org = "", key = "", until = "" });
            }
            else if (type == "scanDriverUi")
            {
                string dev = root.TryGetProperty("device", out var sd) ? (sd.GetString() ?? "") : "";
                _ = DriverUiAsync(dev);
            }
        }
        catch { }
    }

    // Обновление программы: скачиваем установщик, показывая ход загрузки,
    // затем закрываем программу и ставим новую версию. После установки
    // программа запускается снова — участие пользователя не требуется
    async Task InstallUpdateAsync(string url, string version)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            SendUpdate(new { type = "updateState", state = "error", error = "Ссылка на обновление не получена." });
            return;
        }

        if (Updater.Busy) return;

        var cts = Updater.Begin();
        SendUpdate(new { type = "updateState", state = "start" });

        try
        {
            string setup = await Updater.DownloadAsync(url, version, (percent, got, total) =>
            {
                SendUpdate(new
                {
                    type = "updateState",
                    state = "progress",
                    percent,
                    loaded = got,
                    total,
                });
            }, cts.Token);

            SendUpdate(new { type = "updateState", state = "installing" });
            await Task.Delay(700);

            Updater.RunInstaller(setup);

            // Помощник установки уже ждёт закрытия окна
            await Task.Delay(400);
            Close();
        }
        catch (OperationCanceledException)
        {
            SendUpdate(new { type = "updateState", state = "cancelled" });
        }
        catch (Exception ex)
        {
            SendUpdate(new { type = "updateState", state = "error", error = ex.Message });
        }
        finally
        {
            Updater.End();
        }
    }

    // Список сканеров опрашиваем в стороне от окна: у сетевых устройств
    // ответ занимает секунды, и программа не должна на это замирать
    async Task ListScannersAsync()
    {
        var list = await Task.Run(() => Scanner.List());
        string hint = list.Count > 0 ? "" : await Task.Run(() => Scanner.Diagnose());

        SendUpdate(new
        {
            type = "scanners",
            items = list.Select(d => new
            {
                id = d.Id,
                name = d.Name,
                feeder = d.HasFeeder,
                duplex = d.HasDuplex,
                twain = d.Twain,
            }),
            hint,
        });
    }

    // Сканирование пачки. Каждый снятый лист сразу уходит в интерфейс,
    // поэтому страницы появляются на экране по ходу работы
    async Task ScanAsync(Scanner.Options opt)
    {
        if (_scanCancel != null)
        {
            SendUpdate(new { type = "scanDone", ok = false, error = "Сканирование уже идёт." });
            return;
        }

        var cts = new CancellationTokenSource();
        _scanCancel = cts;

        string dir = Path.Combine(_openDir, "scan_" + DateTime.Now.Ticks);

        try
        {
            SendUpdate(new { type = "scanState", state = "start" });

            var files = await Task.Run(() => Scanner.Scan(
                opt,
                dir,
                (n, path) => SendUpdate(new
                {
                    type = "scanPage",
                    index = n,
                    url = FileUrl(path),
                }),
                cts.Token), cts.Token);

            SendUpdate(new
            {
                type = "scanDone",
                ok = true,
                pages = files.Select(FileUrl),
                // Чего сканер не умеет — окно покажет подсказкой
                ignored = TwainBridge.Ignored.ToArray(),
            });
        }
        catch (OperationCanceledException)
        {
            SendUpdate(new { type = "scanDone", ok = false, cancelled = true });
        }
        catch (Exception ex)
        {
            SendUpdate(new { type = "scanDone", ok = false, error = ex.Message });
        }
        finally
        {
            _scanCancel = null;
            cts.Dispose();
        }
    }

    // Родное окно драйвера сканера. Работает поверх нашего окна,
    // снимок из него попадает в программу как обычная страница
    async Task DriverUiAsync(string device)
    {
        if (_scanCancel != null)
        {
            SendUpdate(new { type = "scanDone", ok = false, error = "Сканирование уже идёт." });
            return;
        }

        string dir = Path.Combine(_openDir, "scan_" + DateTime.Now.Ticks);

        try
        {
            SendUpdate(new { type = "scanState", state = "driver" });

            var files = await Task.Run(() => Scanner.ShowDriverUi(device, dir));

            if (files.Count == 0)
            {
                SendUpdate(new { type = "scanDone", ok = false, cancelled = true });
                return;
            }

            for (int i = 0; i < files.Count; i++)
            {
                SendUpdate(new { type = "scanPage", index = i + 1, url = FileUrl(files[i]) });
            }

            SendUpdate(new { type = "scanDone", ok = true, pages = files.Select(FileUrl) });
        }
        catch (Exception ex)
        {
            SendUpdate(new { type = "scanDone", ok = false, error = ex.Message });
        }
    }

    // Путь к файлу внутри папки открытых документов — в виде адреса,
    // по которому его прочитает просмотрщик
    string FileUrl(string path)
    {
        string rel = Path.GetRelativePath(_openDir, path).Replace('\\', '/');
        return "https://pvspdf.file/" + rel;
    }

    void SendUpdate(object payload)
    {
        try
        {
            if (IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                try
                {
                    _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
                }
                catch { }
            }));
        }
        catch { }
    }

    // Настройки принтера: открываем окно свойств драйвера Windows
    void OpenPrinterSetup(string printer)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(printer))
            {
                OpenPrintersFolder();
                return;
            }

            // Окно свойств выбранного принтера
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "rundll32.exe",
                Arguments = $"printui.dll,PrintUIEntry /p /n \"{printer}\"",
                UseShellExecute = true
            });
        }
        catch
        {
            OpenPrintersFolder();
        }
    }

    static void OpenPrintersFolder()
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = "rundll32.exe",
                Arguments = "shell32.dll,Control_RunDLL printers",
                UseShellExecute = true
            });
        }
        catch { }
    }

    // Печать: пользователь выбирает принтер в окне Windows,
    // документ печатается напрямую, лишние окна не показываются
    async Task PrintPdfAsync(string base64, string fileName, string printer = "")
    {
        try
        {
            byte[] bytes = Convert.FromBase64String(base64);

            string safe = string.Concat(fileName.Split(Path.GetInvalidFileNameChars()));
            if (string.IsNullOrWhiteSpace(safe)) safe = "document.pdf";
            if (!safe.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) safe += ".pdf";

            string dir = Path.Combine(Path.GetTempPath(), "PVSPDF");
            Directory.CreateDirectory(dir);
            CleanupTemp(dir);

            string path = Path.Combine(dir, $"{Guid.NewGuid():N}_{safe}");
            await File.WriteAllBytesAsync(path, bytes);

            var win = new PrintWindow(path, _web.CoreWebView2.Environment, (ok, info) =>
            {
                if (ok)
                {
                    PostToPage(new { type = "printDone", ok = true, printer = info });
                }
                else if (info == null)
                {
                    PostToPage(new { type = "printDone", ok = false, cancelled = true });
                }
                else
                {
                    PostToPage(new { type = "printDone", ok = false, error = info });
                    MessageBox.Show(
                        "Не удалось напечатать документ.\r\n\r\n" + info,
                        "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }, printer);

            win.Owner = this;
            win.Show();
        }
        catch (Exception ex)
        {
            PostToPage(new { type = "printDone", ok = false, error = ex.Message });
            MessageBox.Show(
                "Не удалось отправить документ на печать.\r\n\r\n" + ex.Message,
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    static void CleanupTemp(string dir)
    {
        try
        {
            foreach (var f in Directory.GetFiles(dir, "*.pdf"))
            {
                if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddHours(-6))
                {
                    try { File.Delete(f); } catch { }
                }
            }
        }
        catch { }
    }

    // Сохранение через системное окно "Сохранить как" с выбором папки
    async Task SaveFileAsync(string base64, string fileName)
    {
        try
        {
            byte[] bytes = Convert.FromBase64String(base64);

            string safe = string.Concat(fileName.Split(Path.GetInvalidFileNameChars()));
            if (string.IsNullOrWhiteSpace(safe)) safe = "document.pdf";
            string ext = Path.GetExtension(safe).TrimStart('.').ToLowerInvariant();
            if (ext.Length == 0) { ext = "pdf"; safe += ".pdf"; }

            string filter = ext switch
            {
                "pdf" => "Документ PDF (*.pdf)|*.pdf",
                "docx" => "Документ Word (*.docx)|*.docx",
                "xlsx" => "Таблица Excel (*.xlsx)|*.xlsx",
                "txt" => "Текстовый файл (*.txt)|*.txt",
                "jpg" or "jpeg" => "Изображение JPEG (*.jpg)|*.jpg",
                "png" => "Изображение PNG (*.png)|*.png",
                "zip" => "Архив ZIP (*.zip)|*.zip",
                _ => $"Файл (*.{ext})|*.{ext}"
            };

            using var dlg = new SaveFileDialog
            {
                Title = "Сохранить как",
                FileName = safe,
                DefaultExt = ext,
                Filter = filter + "|Все файлы (*.*)|*.*",
                AddExtension = true,
                OverwritePrompt = true,
                RestoreDirectory = true,
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
            };

            if (dlg.ShowDialog(this) != DialogResult.OK)
            {
                PostToPage(new { type = "saveDone", ok = false, cancelled = true });
                return;
            }

            await File.WriteAllBytesAsync(dlg.FileName, bytes);
            PostToPage(new { type = "saveDone", ok = true, path = dlg.FileName });
        }
        catch (Exception ex)
        {
            PostToPage(new { type = "saveDone", ok = false, error = ex.Message });
            MessageBox.Show(
                "Не удалось сохранить файл.\r\n\r\n" + ex.Message,
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    // Пакетное сохранение: папку спрашиваем один раз
    async Task SaveManyAsync(List<(string Name, string Data)> files)
    {
        try
        {
            using var dlg = new FolderBrowserDialog
            {
                Description = "Выберите папку для сохранения файлов",
                UseDescriptionForTitle = true,
                ShowNewFolderButton = true
            };

            if (dlg.ShowDialog(this) != DialogResult.OK)
            {
                PostToPage(new { type = "saveDone", ok = false, cancelled = true });
                return;
            }

            foreach (var f in files)
            {
                string safe = string.Concat(f.Name.Split(Path.GetInvalidFileNameChars()));
                if (string.IsNullOrWhiteSpace(safe)) continue;
                await File.WriteAllBytesAsync(
                    Path.Combine(dlg.SelectedPath, safe),
                    Convert.FromBase64String(f.Data));
            }

            PostToPage(new { type = "saveDone", ok = true, path = dlg.SelectedPath, count = files.Count });
        }
        catch (Exception ex)
        {
            PostToPage(new { type = "saveDone", ok = false, error = ex.Message });
            MessageBox.Show(
                "Не удалось сохранить файлы.\r\n\r\n" + ex.Message,
                "ПВ-Система PDF", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    void PostToPage(object msg)
    {
        try
        {
            _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(msg));
        }
        catch { }
    }
}