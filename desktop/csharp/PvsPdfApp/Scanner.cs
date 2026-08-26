using System.Runtime.InteropServices;

namespace PvsPdfApp;

// Работа со сканером через службу Windows (WIA). Драйверы ставит сам
// производитель устройства — программа лишь просит у Windows готовые снимки.
// Всё делается на компьютере пользователя, никуда ничего не отправляется
internal static class Scanner
{
    // Свойства снимка в терминах WIA
    const uint DPI_X = 6147;
    const uint DPI_Y = 6148;
    const uint EXTENT_X = 6151;
    const uint EXTENT_Y = 6152;
    const uint MODE = 6146;         // 0 — ч/б, 1 — оттенки серого, 2 — цвет
    const uint PAGES = 3096;        // сколько листов взять из автоподатчика
    const uint HANDLING = 3088;     // откуда брать: стекло или автоподатчик

    const int FEEDER = 0x001;
    const int FLATBED = 0x002;
    const int DUPLEX = 0x004;

    const string JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";

    public sealed class Options
    {
        public string DeviceId = "";
        public int Dpi = 300;
        public string Color = "color";   // color | gray | bw
        public bool Feeder;              // брать из автоподатчика
        public bool Duplex;              // обе стороны листа
        public int Limit;                // 0 — пока не кончится бумага
    }

    public sealed class Device
    {
        public string Id = "";
        public string Name = "";
        public bool HasFeeder;
        public bool HasDuplex;
    }

    // Список подключённых сканеров. Если служба недоступна,
    // возвращаем пустой список — интерфейс сам объяснит это пользователю
    public static List<Device> List()
    {
        var found = new List<Device>();
        dynamic? mgr = null;

        try
        {
            mgr = MakeCom("WIA.DeviceManager");
            if (mgr == null) return found;

            foreach (dynamic info in mgr.DeviceInfos)
            {
                try
                {
                    if ((int)info.Type != 1) continue;   // 1 — сканер

                    string id = info.DeviceID;
                    string name = Prop(info.Properties, "Name") ?? "Сканер";

                    int caps = 0;
                    try { caps = Convert.ToInt32(Prop(info.Properties, "Document Handling Capabilities") ?? "0"); }
                    catch { }

                    found.Add(new Device
                    {
                        Id = id,
                        Name = name,
                        HasFeeder = (caps & FEEDER) != 0,
                        HasDuplex = (caps & DUPLEX) != 0,
                    });
                }
                catch { }
            }
        }
        catch { }
        finally { Release(mgr); }

        return found;
    }

    // Снимаем страницы и складываем их картинками в указанную папку.
    // onPage вызывается после каждого листа — интерфейс сразу показывает,
    // сколько уже отсканировано, не дожидаясь всей пачки
    public static List<string> Scan(Options opt, string dir, Action<int, string> onPage, CancellationToken token)
    {
        var files = new List<string>();
        Directory.CreateDirectory(dir);

        dynamic? mgr = null;
        dynamic? device = null;

        try
        {
            mgr = MakeCom("WIA.DeviceManager")
                ?? throw new InvalidOperationException(
                    "Служба сканирования Windows недоступна. Проверьте, что служба «Загрузка изображений (WIA)» запущена.");

            dynamic? info = null;
            foreach (dynamic d in mgr.DeviceInfos)
            {
                if ((int)d.Type != 1) continue;
                if (string.IsNullOrEmpty(opt.DeviceId) || (string)d.DeviceID == opt.DeviceId)
                {
                    info = d;
                    break;
                }
            }

            if (info == null)
                throw new InvalidOperationException("Сканер не найден. Проверьте, что он включён и подключён к компьютеру.");

            device = info.Connect();
            dynamic item = device.Items[1];

            Setup(device, item, opt);

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 200;

            while (made < cap)
            {
                token.ThrowIfCancellationRequested();

                dynamic? image = null;
                try
                {
                    image = item.Transfer(JPEG);
                }
                catch (COMException ex)
                {
                    // Бумага в автоподатчике кончилась — это не ошибка,
                    // а обычное завершение пачки
                    if (Empty(ex) && made > 0) break;
                    if (Empty(ex))
                        throw new InvalidOperationException(
                            opt.Feeder
                                ? "В автоподатчике нет бумаги. Положите листы и повторите."
                                : "Сканер не отдал изображение. Проверьте, что документ лежит на стекле.");
                    throw;
                }

                made++;
                string path = Path.Combine(dir, $"scan_{made:D3}.jpg");
                try { if (File.Exists(path)) File.Delete(path); } catch { }

                image.SaveFile(path);
                Release(image);

                files.Add(path);
                onPage(made, path);

                // Со стекла берём ровно один лист: следующий пользователь
                // положит сам. Из автоподатчика идём до конца пачки
                if (!opt.Feeder) break;
                if (opt.Limit > 0 && made >= opt.Limit) break;
            }

            return files;
        }
        finally
        {
            Release(device);
            Release(mgr);
        }
    }

    // Настройки съёмки. Некоторые сканеры не понимают часть свойств —
    // такие пропускаем молча, чтобы не срывать всю работу
    static void Setup(dynamic device, dynamic item, Options opt)
    {
        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));

        Set(item.Properties, DPI_X, dpi);
        Set(item.Properties, DPI_Y, dpi);

        // Размер области съёмки — лист A4 при выбранном разрешении
        Set(item.Properties, EXTENT_X, (int)(8.27 * dpi));
        Set(item.Properties, EXTENT_Y, (int)(11.69 * dpi));

        int mode = opt.Color switch { "bw" => 0, "gray" => 1, _ => 2 };
        Set(item.Properties, MODE, mode);

        if (opt.Feeder)
        {
            int handling = FEEDER | (opt.Duplex ? DUPLEX : 0);
            Set(device.Properties, HANDLING, handling);
            Set(device.Properties, PAGES, opt.Limit > 0 ? opt.Limit : 0);
        }
        else
        {
            Set(device.Properties, HANDLING, FLATBED);
        }
    }

    static void Set(dynamic props, uint id, int value)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((uint)p.PropertyID != id) continue;
                p.Value = value;
                return;
            }
        }
        catch { }
    }

    static string? Prop(dynamic props, string name)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((string)p.Name == name) return Convert.ToString(p.Value);
            }
        }
        catch { }
        return null;
    }

    // Признак «бумага кончилась» в ответе службы сканирования
    static bool Empty(COMException ex)
    {
        unchecked
        {
            int code = ex.ErrorCode;
            return code == (int)0x80210003    // нет бумаги
                || code == (int)0x80210002    // занят
                || code == (int)0x8021000D;   // подача завершена
        }
    }

    static dynamic? MakeCom(string progId)
    {
        try
        {
            Type? t = Type.GetTypeFromProgID(progId);
            return t == null ? null : Activator.CreateInstance(t);
        }
        catch { return null; }
    }

    static void Release(object? com)
    {
        try { if (com != null && Marshal.IsComObject(com)) Marshal.ReleaseComObject(com); }
        catch { }
    }
}
