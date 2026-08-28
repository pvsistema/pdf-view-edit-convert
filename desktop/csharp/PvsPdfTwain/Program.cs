using System.Text;
using System.Text.Json;

namespace PvsPdfTwain;

// Помощник вызывается основной программой и общается с ней короткими
// ответами. Своего окна и меню у него нет.
//
//   PVSPDF-twain.exe list
//       перечислить сканеры
//
//   PVSPDF-twain.exe scan <папка> [--device "имя"] [--dpi 300]
//                    [--color color|gray|bw] [--feeder] [--duplex]
//                    [--limit N] [--ui]
//       снять страницы и сложить картинками в папку
internal static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Своей консоли у помощника нет — он пишет ответ основной
        // программе. Смена кодировки в таком случае не нужна и может
        // не сработать, поэтому пробуем осторожно
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }

        try
        {
            if (args.Length == 0) return Fail("Не указано, что делать.");

            switch (args[0].ToLowerInvariant())
            {
                case "list": return DoList();
                case "scan": return DoScan(args);
                default: return Fail("Неизвестная команда.");
            }
        }
        catch (DllNotFoundException)
        {
            return Fail("На компьютере не установлен драйвер TWAIN.");
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
        finally
        {
            Handle.Close();
        }
    }

    static int DoList()
    {
        var list = Twain.List();
        Say(new
        {
            ok = true,
            items = list.Select(d => new { name = d.Name, feeder = d.HasFeeder, duplex = d.HasDuplex }),
        });
        return 0;
    }

    static int DoScan(string[] args)
    {
        if (args.Length < 2) return Fail("Не указана папка для страниц.");

        string dir = args[1];
        var opt = new Twain.Options();

        for (int i = 2; i < args.Length; i++)
        {
            string a = args[i].ToLowerInvariant();
            string next = i + 1 < args.Length ? args[i + 1] : "";

            switch (a)
            {
                case "--device": opt.Device = next; i++; break;
                case "--dpi": opt.Dpi = int.TryParse(next, out int d) ? d : 300; i++; break;
                case "--color": opt.Color = next; i++; break;
                case "--limit": opt.Limit = int.TryParse(next, out int n) ? n : 0; i++; break;
                case "--feeder": opt.Feeder = true; break;
                case "--duplex": opt.Duplex = true; break;
                case "--ui": opt.ShowUi = true; break;
            }
        }

        // Каждый снятый лист сообщаем сразу: основная программа
        // показывает страницы по ходу работы, а не в самом конце
        var files = Twain.Scan(opt, dir, (index, path) =>
        {
            Console.WriteLine(JsonSerializer.Serialize(new { page = index, path }));
            Console.Out.Flush();
        });

        // refused — настройки, которые сканер не принял. Программа
        // предупредит о них, чтобы результат не был неожиданностью
        Say(new { ok = true, pages = files, refused = Twain.Refused() });
        return 0;
    }

    static void Say(object data) => Console.WriteLine(JsonSerializer.Serialize(data));

    static int Fail(string message)
    {
        Say(new { ok = false, error = message });
        return 1;
    }
}