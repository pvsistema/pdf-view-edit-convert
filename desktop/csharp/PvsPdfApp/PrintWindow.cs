using System.Drawing.Printing;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PvsPdfApp;

// Печать документа: невидимое окно загружает готовый PDF,
// пользователь выбирает принтер в обычном окне Windows,
// после чего документ печатается напрямую - без окон браузера.
public class PrintWindow : Form
{
    readonly WebView2 _web = new();
    readonly string _file;
    readonly CoreWebView2Environment _env;
    readonly Action<bool, string?> _done;
    readonly bool _choose;
    bool _started;

    // choose = true - принудительно показать выбор принтера
    public PrintWindow(string file, CoreWebView2Environment env, Action<bool, string?> done, bool choose = false)
    {
        _file = file;
        _env = env;
        _done = done;
        _choose = choose;

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
            PrinterSettings ps;
            string? saved = Settings.Printer;

            // Печатаем сразу на запомненный принтер, если он на месте
            if (!_choose && Settings.RememberPrinter && !string.IsNullOrEmpty(saved) && PrinterExists(saved))
            {
                ps = new PrinterSettings { PrinterName = saved };
            }
            else
            {
                using var dlg = new PrintDialog
                {
                    AllowSomePages = false,
                    AllowSelection = false,
                    AllowPrintToFile = false,
                    UseEXDialog = true
                };

                if (!string.IsNullOrEmpty(saved) && PrinterExists(saved))
                    dlg.PrinterSettings.PrinterName = saved;

                if (dlg.ShowDialog(Owner) != DialogResult.OK)
                {
                    Finish(false, null);
                    return;
                }

                ps = dlg.PrinterSettings;
                Settings.Printer = ps.PrinterName;
            }

            var settings = _web.CoreWebView2.Environment.CreatePrintSettings();
            settings.PrinterName = ps.PrinterName;
            settings.Copies = ps.Copies < 1 ? 1 : (int)ps.Copies;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;

            settings.Orientation = ps.DefaultPageSettings.Landscape
                ? CoreWebView2PrintOrientation.Landscape
                : CoreWebView2PrintOrientation.Portrait;

            settings.ColorMode = ps.DefaultPageSettings.Color
                ? CoreWebView2PrintColorMode.Color
                : CoreWebView2PrintColorMode.Grayscale;

            // Печатаем без полей: отступы уже заложены в самом документе
            settings.MarginTop = 0;
            settings.MarginBottom = 0;
            settings.MarginLeft = 0;
            settings.MarginRight = 0;

            var status = await _web.CoreWebView2.PrintAsync(settings);

            if (status == CoreWebView2PrintStatus.Succeeded)
            {
                Finish(true, ps.PrinterName);
            }
            else if (status == CoreWebView2PrintStatus.PrinterUnavailable)
            {
                Finish(false, "Принтер недоступен: " + ps.PrinterName);
            }
            else
            {
                Finish(false, "Принтер не принял документ");
            }
        }
        catch (Exception ex)
        {
            Finish(false, ex.Message);
        }
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