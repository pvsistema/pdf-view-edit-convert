using System.Diagnostics;

namespace PvsPdfApp;

internal static class Program
{
    // Папка программы на диске C
    public const string InstallDir = @"C:\PVSPDF";

    [STAThread]
    static void Main(string[] args)
    {
        // Один экземпляр программы
        using var mutex = new Mutex(true, "PVSPDF_SingleInstance", out bool isNew);
        if (!isNew)
        {
            MessageBox.Show(
                "ПВ-Система PDF уже запущена.",
                "ПВ-Система PDF",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        Application.ThreadException += (s, e) => ShowFatal(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => ShowFatal(e.ExceptionObject as Exception);

        string? openFile = args.FirstOrDefault(a =>
            a.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && File.Exists(a));

        Application.Run(new MainForm(openFile));
    }

    static void ShowFatal(Exception? ex)
    {
        try
        {
            string log = Path.Combine(InstallDir, "error.log");
            Directory.CreateDirectory(InstallDir);
            File.AppendAllText(log, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {ex}\r\n\r\n");
        }
        catch { }

        MessageBox.Show(
            "Произошла ошибка:\r\n\r\n" + (ex?.Message ?? "неизвестная ошибка") +
            "\r\n\r\nПодробности записаны в файл error.log в папке программы.",
            "ПВ-Система PDF",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
