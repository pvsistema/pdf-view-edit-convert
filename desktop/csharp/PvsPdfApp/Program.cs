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
        // Пользователь мог выделить сразу несколько документов —
        // каждый откроется своей вкладкой
        string[] openFiles = args
            .Where(a => a.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && File.Exists(a))
            .ToArray();

        // Один экземпляр программы
        using var mutex = new Mutex(true, "PVSPDF_SingleInstance", out bool isNew);
        if (!isNew)
        {
            // Программа уже открыта: передаём ей документы и выходим,
            // они добавятся вкладками в уже запущенном окне
            if (!SendToRunning(openFiles))
            {
                MessageBox.Show(
                    "ПВ-Система PDF уже запущена.",
                    "ПВ-Система PDF",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return;
        }

        // Готовим просмотрщик заранее, параллельно с открытием окна:
        // это самая долгая часть запуска, и ждать её впустую незачем
        MainForm.WarmUp();

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        Application.ThreadException += (s, e) => ShowFatal(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => ShowFatal(e.ExceptionObject as Exception);

        Application.Run(new MainForm(openFiles));
    }

    static bool SendToRunning(string[] files)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            pipe.Connect(2000);
            // Документы разделяем переводом строки: в именах файлов
            // такого символа быть не может
            byte[] data = Encoding.UTF8.GetBytes(string.Join("\n", files));
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