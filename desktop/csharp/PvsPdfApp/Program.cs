using System.IO.Pipes;
using System.Text;

namespace PvsPdfApp;

internal static class Program
{
    // Папка программы на диске C
    public const string InstallDir = @"C:\PVSPDF";

    public const string PipeName = "PVSPDF_Open_Pipe";

    [STAThread]
    static void Main(string[] args)
    {
        string? openFile = args.FirstOrDefault(a =>
            a.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && File.Exists(a));

        // Один экземпляр программы
        using var mutex = new Mutex(true, "PVSPDF_SingleInstance", out bool isNew);
        if (!isNew)
        {
            // Программа уже открыта: передаём ей файл и выходим,
            // документ откроется в уже запущенном окне
            if (!SendToRunning(openFile))
            {
                MessageBox.Show(
                    "ПВ-Система PDF уже запущена.",
                    "ПВ-Система PDF",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        Application.ThreadException += (s, e) => ShowFatal(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => ShowFatal(e.ExceptionObject as Exception);

        Application.Run(new MainForm(openFile));
    }

    static bool SendToRunning(string? file)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            pipe.Connect(2000);
            byte[] data = Encoding.UTF8.GetBytes(file ?? "");
            pipe.Write(data, 0, data.Length);
            pipe.Flush();
            return true;
        }
        catch
        {
            return false;
        }
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
