[assembly: System.Runtime.Versioning.SupportedOSPlatform("linux")]

namespace PvsPdfLinux;

internal static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Файлы приходят как пути или как адреса file:// (так их
        // передают файловые менеджеры)
        string[] openFiles = args
            .Select(a => a.StartsWith("file://") ? Uri.UnescapeDataString(new Uri(a).LocalPath) : a)
            .Where(a => a.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && File.Exists(a))
            .Select(Path.GetFullPath)
            .ToArray();

        if (!SingleInstance.Acquire())
        {
            if (SingleInstance.SendToRunning(openFiles)) return 0;
            Console.Error.WriteLine("ПВ-Система PDF уже запущена.");
            return 0;
        }

        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            AppLog.Error("сбой", "Необработанная ошибка программы", e.ExceptionObject as Exception);

        _ = Task.Run(AppLog.Cleanup);

        if (!File.Exists(Path.Combine(Paths.WebRoot, "index.html")))
        {
            Fatal("Не найдены файлы интерфейса программы (папка web).\nПереустановите ПВ-Система PDF.");
            return 1;
        }

        try
        {
            new MainWindow(openFiles).Run();
            return 0;
        }
        catch (Exception ex) when (ex is DllNotFoundException || ex.InnerException is DllNotFoundException)
        {
            AppLog.Error("запуск", "Нет библиотеки окна", ex);
            Fatal("Не удалось запустить окно программы: в системе нет компонента WebKitGTK.\n\n" +
                  "Astra Linux: sudo apt install libwebkit2gtk-4.0-37\n" +
                  "РЕД ОС: sudo dnf install webkit2gtk3\n" +
                  "Альт: sudo apt-get install libwebkit2gtk\n\n" + ex.Message);
            return 1;
        }
        catch (Exception ex)
        {
            AppLog.Error("запуск", "Программа не запустилась", ex);
            Fatal("Программа не запустилась:\n\n" + ex.Message + "\n\nПодробности в журнале: " + AppLog.Dir);
            return 1;
        }
    }

    // Окна ещё нет — сообщаем через zenity/kdialog, а если их нет, в консоль
    static void Fatal(string text)
    {
        Console.Error.WriteLine(text);
        try
        {
            if (Shell.Exists("zenity"))
                Shell.Run("zenity", new[] { "--error", "--no-wrap", "--title=ПВ-Система PDF", "--text=" + text.Replace("&", "&amp;").Replace("<", "&lt;") }, int.MaxValue);
            else if (Shell.Exists("kdialog"))
                Shell.Run("kdialog", new[] { "--title", "ПВ-Система PDF", "--error", text }, int.MaxValue);
        }
        catch { }
    }
}
