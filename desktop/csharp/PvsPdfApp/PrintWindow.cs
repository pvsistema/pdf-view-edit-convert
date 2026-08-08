using System.Drawing.Printing;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PvsPdfApp;

// Печать документа: невидимое окно загружает готовый PDF и сразу
// отправляет его на выбранный принтер. Принтер выбирается в окне
// настроек печати самой программы, окна Windows не показываются.
public class PrintWindow : Form
{
    readonly WebView2 _web = new();
    readonly string _file;
    readonly CoreWebView2Environment _env;
    readonly Action<bool, string?> _done;
    readonly string _printer;
    bool _started;

    public PrintWindow(string file, CoreWebView2Environment env, Action<bool, string?> done, string printer = "")
    {
        _file = file;
        _env = env;
        _done = done;
        _printer = printer;

        // Окно нужно только для загрузки документа, пользователь его не видит
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        Size = new Size(1000, 1200);

        _web.Dock = DockStyle.Fill;
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
        try
        {
            await _web.EnsureCoreWebView2Async(_env);

            _web.CoreWebView2.NavigationCompleted += async (s, e) =>
            {
                if (_started) return;
                _started = true;

                // Даём просмотрщику разложить страницы
                await Task.Delay(500);
                await PrintAsync();
            };

            _web.CoreWebView2.Navigate(new Uri(_file).AbsoluteUri);
        }
        catch (Exception ex)
        {
            Finish(false, ex.Message);
        }
    }

    async Task PrintAsync()
    {
        try
        {
            string name = ResolvePrinter();

            if (string.IsNullOrEmpty(name))
            {
                Finish(false, "В системе не найден ни один принтер");
                return;
            }

            Settings.Printer = name;

            var settings = _web.CoreWebView2.Environment.CreatePrintSettings();
            settings.PrinterName = name;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;

            // Размер листа и количество копий уже заложены в самом документе,
            // который программа собрала по настройкам окна печати
            settings.MarginTop = 0;
            settings.MarginBottom = 0;
            settings.MarginLeft = 0;
            settings.MarginRight = 0;

            var status = await _web.CoreWebView2.PrintAsync(settings);

            if (status == CoreWebView2PrintStatus.Succeeded)
                Finish(true, name);
            else if (status == CoreWebView2PrintStatus.PrinterUnavailable)
                Finish(false, "Принтер недоступен: " + name);
            else
                Finish(false, "Принтер не принял документ");
        }
        catch (Exception ex)
        {
            Finish(false, ex.Message);
        }
    }

    // Принтер из окна печати, иначе прошлый выбор, иначе принтер по умолчанию
    string ResolvePrinter()
    {
        if (!string.IsNullOrEmpty(_printer) && PrinterExists(_printer)) return _printer;

        string? saved = Settings.Printer;
        if (!string.IsNullOrEmpty(saved) && PrinterExists(saved)) return saved;

        try
        {
            string def = new PrinterSettings().PrinterName ?? "";
            if (!string.IsNullOrEmpty(def) && PrinterExists(def)) return def;
        }
        catch { }

        try
        {
            foreach (string p in PrinterSettings.InstalledPrinters) return p;
        }
        catch { }

        return "";
    }

    static bool PrinterExists(string name)
    {
        try
        {
            foreach (string p in PrinterSettings.InstalledPrinters)
                if (string.Equals(p, name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        catch { }
        return false;
    }

    void Finish(bool ok, string? info)
    {
        try { _done(ok, info); } catch { }
        try { Close(); } catch { }
    }
}
