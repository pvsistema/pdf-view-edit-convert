using System.Text;
using System.Text.Json;

namespace PvsPdfTwain;

// Помощник вызывается основной программой и общается с ней короткими
// ответами. Своего окна и меню у него нет.
//
//   PVSPDF-twain.exe list
//       перечислить сканеры
//
//   PVSPDF-twain.exe selftest
//       отчёт о самопроверке: где искали диспетчер, что нашли
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
                case "selftest": return DoSelfTest();
                case "caps": return DoCaps(args);
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

    // Какое качество умеет выбранный аппарат
    static int DoCaps(string[] args)
    {
        string device = "";
        for (int i = 1; i < args.Length - 1; i++)
            if (args[i] == "--device") device = args[i + 1];

        if (device.Length == 0) return Fail("Не указан сканер.");
        Say(new { ok = true, dpi = Twain.Resolutions(device) });
        return 0;
    }

    // Самопроверка: что помощник видит на этом компьютере.
    // По ней сразу понятно, на каком шаге теряется сканер
    static int DoSelfTest()
    {
        Say(new { ok = true, report = Twain.SelfTest() });
        return 0;
    }

    static int DoList()
    {
        // Спрашиваем два источника: драйверы производителей (TWAIN)
        // и службу Windows. Служба тоже показывает лишь драйверы своей
        // разрядности, поэтому спрашивать её нужно отсюда, а не из
        // главной программы — иначе 32-разрядные драйверы не видны
        var items = new List<object>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var d in Twain.List())
                if (seen.Add(d.Name))
                    items.Add(new { name = d.Name, id = "", feeder = d.HasFeeder, duplex = d.HasDuplex, wia = false });
        }
        catch { }

        try
        {
            foreach (var d in Wia.List())
                if (seen.Add(d.Name))
                    items.Add(new { name = d.Name, id = d.Id, feeder = d.HasFeeder, duplex = d.HasDuplex, wia = true });
        }
        catch { }

        // Третий источник — прямой разговор со службой Windows, минуя
        // старую надстройку. Она на части компьютеров отвечает
        // «устройств ноль» даже при исправном сканере
        try
        {
            foreach (var d in WiaDirect.List())
                if (seen.Add(d.Name))
                    items.Add(new { name = d.Name, id = d.Id, feeder = false, duplex = false, wia = true });
        }
        catch { }

        // Прямой опрос файлов драйверов в список НЕ идёт: проверка на
        // живом компьютере показала, что так драйверы себя не называют
        // — отказом отвечает даже Epson, прекрасно работающий через
        // посредника. Опрос остаётся только в отчёте, для диагностики

        Say(new { ok = true, items });
        return 0;
    }

    static int DoScan(string[] args)
    {
        if (args.Length < 2) return Fail("Не указана папка для страниц.");

        string dir = args[1];
        var opt = new Twain.Options();
        bool wia = false;   // снимать через службу Windows, а не драйвер

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
                case "--wia": wia = true; break;
            }
        }

        // Каждый снятый лист сообщаем сразу: основная программа
        // показывает страницы по ходу работы, а не в самом конце
        void Page(int index, string path)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { page = index, path }));
            Console.Out.Flush();
        }

        // Аппарат может быть известен либо драйверу производителя,
        // либо службе Windows. Начинаем с того, что указала программа
        List<string> files;
        if (wia)
        {
            // Сначала обычным путём. Если надстройка этот сканер не
            // видит — просим снять саму службу Windows
            try { files = Wia.Scan(opt, dir, Page); }
            catch (Exception) { files = Direct(dir, Page); }
        }
        else
        {
            try { files = Twain.Scan(opt, dir, Page); }
            catch (Exception) when (Wia.Ready())
            {
                try { files = Wia.Scan(opt, dir, Page); }
                catch (Exception) { files = Direct(dir, Page); }
            }
        }

        // refused — настройки, которые сканер не принял. Программа
        // предупредит о них, чтобы результат не был неожиданностью
        Say(new { ok = true, pages = files, refused = Twain.Refused() });
        return 0;
    }

    // Съёмка силами самой службы Windows — запасной путь для аппаратов,
    // которых не видит старая надстройка
    static List<string> Direct(string dir, Action<int, string> onPage)
    {
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, "scan_001.bmp");
        try { if (File.Exists(path)) File.Delete(path); } catch { }

        string? error = WiaDirect.ScanToFile(path);
        if (error != null) throw new InvalidOperationException(error);

        onPage(1, path);
        return new List<string> { path };
    }

    static void Say(object data) => Console.WriteLine(JsonSerializer.Serialize(data));

    static int Fail(string message)
    {
        Say(new { ok = false, error = message });
        return 1;
    }
}