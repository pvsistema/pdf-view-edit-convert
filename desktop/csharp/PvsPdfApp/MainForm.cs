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

        // Сообщаем странице, что она работает в десктопной версии
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "window.PVSPDF_DESKTOP = true;" +
            "window.PVSPDF_VERSION = '" + AppVersion() + "';");

        core.Navigate("https://pvspdf.local/index.html");

        if (!string.IsNullOrEmpty(_openFile))
        {
            core.NavigationCompleted += async (s, e) =>
            {
                await Task.Delay(300);
                await SendFileAsync(_openFile!);
            };
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
        }
        catch { }
    }
}
