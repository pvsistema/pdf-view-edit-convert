using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PvsPdfApp;

// Окно печати: показывает PDF во встроенном просмотрщике WebView2
// и сразу открывает системный диалог выбора принтера.
public class PrintWindow : Form
{
    readonly WebView2 _web = new();
    readonly string _file;
    readonly CoreWebView2Environment _env;
    bool _printed;

    public PrintWindow(string file, CoreWebView2Environment env)
    {
        _file = file;
        _env = env;

        Text = "Печать — " + Path.GetFileName(file).Split('_').Last();
        Width = 900;
        Height = 700;
        MinimumSize = new Size(600, 450);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = ColorTranslator.FromHtml("#F7F6F2");
        ShowInTaskbar = false;

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
        FormClosed += (s, e) =>
        {
            try { _web.Dispose(); } catch { }
            try { File.Delete(_file); } catch { }
        };
    }

    async Task StartAsync()
    {
        await _web.EnsureCoreWebView2Async(_env);

        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;

        _web.CoreWebView2.NavigationCompleted += async (s, e) =>
        {
            if (_printed) return;
            _printed = true;

            // Даём просмотрщику отрисовать страницы
            await Task.Delay(400);
            await ShowPrintDialogAsync();
        };

        _web.CoreWebView2.Navigate(new Uri(_file).AbsoluteUri);
    }

    async Task ShowPrintDialogAsync()
    {
        try
        {
            // Системный диалог печати Windows
            _web.CoreWebView2.ShowPrintUI(CoreWebView2PrintDialogKind.System);
        }
        catch
        {
            try
            {
                // Запасной путь для старых сборок WebView2
                await _web.CoreWebView2.ExecuteScriptAsync("window.print()");
            }
            catch { }
        }
    }
}
