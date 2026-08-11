using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PvsPdfApp;

public class MainForm : Form
{
    readonly WebView2 _web = new();
    readonly string? _openFile;
    string _webRoot = "";

    public MainForm(string? openFile = null)
    {
        _openFile = openFile;

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
            "window.PVSPDF_PRINTERS = [];");

        core.Navigate("https://pvspdf.local/index.html");

        core.NavigationCompleted += async (s, e) =>
        {
            if (!string.IsNullOrEmpty(_openFile))
            {
                await Task.Delay(150);
                await SendFileAsync(_openFile!);
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
                    string path = (await reader.ReadToEndAsync()).Trim();

                    BeginInvoke(new Action(async () =>
                    {
                        if (WindowState == FormWindowState.Minimized)
                            WindowState = FormWindowState.Normal;
                        Activate();
                        BringToFront();

                        if (!string.IsNullOrEmpty(path) && File.Exists(path))
                            await SendFileAsync(path);
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

    async Task SendFileAsync(string path)
    {
        try
        {
            byte[] bytes = await File.ReadAllBytesAsync(path);
            var msg = new
            {
                type = "openFile",
                name = Path.GetFileName(path),
                data = Convert.ToBase64String(bytes)
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