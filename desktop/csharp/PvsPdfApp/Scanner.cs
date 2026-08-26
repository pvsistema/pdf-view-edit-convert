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
    const uint POS_X = 6149;
    const uint POS_Y = 6150;
    const uint EXTENT_X = 6151;
    const uint EXTENT_Y = 6152;
    const uint MAX_X = 6165;        // предельная ширина области у устройства
    const uint MAX_Y = 6166;        // предельная высота области
    const uint INTENT = 6146;       // общее пожелание: цвет, серый или текст
    const uint DATATYPE = 4103;     // как именно кодировать точки
    const uint DEPTH = 4104;        // бит на точку
    const uint PAGES = 3096;        // сколько листов взять из автоподатчика
    const uint HANDLING = 3088;     // откуда брать: стекло или автоподатчик

    // Пожелания к снимку. Именно здесь была ошибка: значение 2
    // означает «оттенки серого», поэтому цветной режим давал ч/б
    const int WANT_COLOR = 0x00000001;
    const int WANT_GRAY = 0x00000002;
    const int WANT_TEXT = 0x00000004;

    // Способ кодирования точек
    const int DATA_THRESHOLD = 0;   // ч/б, одна точка — один бит
    const int DATA_GRAY = 2;
    const int DATA_COLOR = 3;

    const int FEEDER = 0x001;
    const int FLATBED = 0x002;
    const int DUPLEX = 0x004;

    const string JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
    const string BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";

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

    // Родное окно сканера от производителя. Нужно капризным устройствам,
    // у которых свои настройки: подсветка, обрезка полей, очистка фона.
    // Снимки оттуда попадают в программу как обычные страницы
    public static List<string> ShowDriverUi(string deviceId, string dir)
    {
        var files = new List<string>();
        Directory.CreateDirectory(dir);

        dynamic? dialog = null;
        dynamic? device = null;
        dynamic? mgr = null;

        try
        {
            dialog = MakeCom("WIA.CommonDialog")
                ?? throw new InvalidOperationException(
                    "Служба сканирования Windows недоступна. Проверьте, что служба «Загрузка изображений (WIA)» запущена.");

            // Подключаемся к выбранному устройству, чтобы Windows не спрашивала
            // о нём повторно — пользователь уже указал сканер в нашем окне
            if (!string.IsNullOrEmpty(deviceId))
            {
                try
                {
                    mgr = MakeCom("WIA.DeviceManager");
                    if (mgr != null)
                    {
                        foreach (dynamic d in mgr.DeviceInfos)
                        {
                            if ((int)d.Type != 1) continue;
                            if ((string)d.DeviceID != deviceId) continue;
                            device = d.Connect();
                            break;
                        }
                    }
                }
                catch { }
            }

            try
            {
                if (device != null)
                {
                    // Окно настроек драйвера для выбранного сканера:
                    // пользователь выставляет всё родными средствами,
                    // после чего снимок забираем обычным способом
                    dynamic item = device.Items[1];
                    bool ok = dialog.ShowItemProperties(item, 0);
                    if (!ok) return files;

                    dynamic? shot = null;
                    try
                    {
                        shot = item.Transfer(JPEG);
                    }
                    catch (COMException ex) when (!Empty(ex))
                    {
                        shot = item.Transfer(BMP);
                    }

                    Save(shot, dir, files, "jpg");
                    return files;
                }

                // Сканер не выбран — показываем полное окно Windows
                // вместе с выбором устройства
                dynamic? image = dialog.ShowAcquireImage(1, 0, 0x00040000, JPEG, false, true, false);
                Save(image, dir, files, "jpg");
                return files;
            }
            catch (COMException ex)
            {
                // Пользователь закрыл окно, ничего не отсканировав
                if (Cancelled(ex) || Empty(ex)) return files;
                throw;
            }
        }
        finally
        {
            Release(device);
            Release(mgr);
            Release(dialog);
        }
    }

    static void Save(dynamic? image, string dir, List<string> files, string ext)
    {
        if (image == null) return;

        string path = Path.Combine(dir, $"scan_{files.Count + 1:D3}.{ext}");
        try { if (File.Exists(path)) File.Delete(path); } catch { }

        image.SaveFile(path);
        Release(image);
        files.Add(path);
    }

    // Пользователь закрыл окно драйвера, ничего не отсканировав
    static bool Cancelled(COMException ex)
    {
        unchecked
        {
            int code = ex.ErrorCode;
            return code == (int)0x80210064   // отменено пользователем
                || code == (int)0x800704C7;  // операция прервана
        }
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
                string ext = "jpg";

                try
                {
                    // JPEG умеют не все драйверы, а чёрно-белый снимок
                    // в него порой вовсе не отдаётся — тогда берём BMP
                    try
                    {
                        image = item.Transfer(JPEG);
                    }
                    catch (COMException ex) when (!Empty(ex))
                    {
                        image = item.Transfer(BMP);
                        ext = "bmp";
                    }
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
                string path = Path.Combine(dir, $"scan_{made:D3}.{ext}");
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

        // Сначала пожелание к снимку, потом всё остальное: драйвер в ответ
        // сам подбирает глубину цвета, и порядок здесь важен. Если задать
        // разрешение раньше, часть сканеров сбрасывает его обратно
        int intent = opt.Color switch
        {
            "bw" => WANT_TEXT,
            "gray" => WANT_GRAY,
            _ => WANT_COLOR,
        };
        Set(item.Properties, INTENT, intent);

        // Прямо указываем способ кодирования и глубину: на одном лишь
        // пожелании часть драйверов продолжает отдавать чёрно-белое
        switch (opt.Color)
        {
            case "bw":
                Set(item.Properties, DATATYPE, DATA_THRESHOLD);
                Set(item.Properties, DEPTH, 1);
                break;
            case "gray":
                Set(item.Properties, DATATYPE, DATA_GRAY);
                Set(item.Properties, DEPTH, 8);
                break;
            default:
                Set(item.Properties, DATATYPE, DATA_COLOR);
                Set(item.Properties, DEPTH, 24);
                break;
        }

        Set(item.Properties, DPI_X, dpi);
        Set(item.Properties, DPI_Y, dpi);

        // Снимаем от левого верхнего угла
        Set(item.Properties, POS_X, 0);
        Set(item.Properties, POS_Y, 0);

        // Область съёмки — лист A4, но не больше, чем умеет устройство:
        // запрос сверх предела драйвер отклоняет вместе со всей настройкой
        int wantW = (int)(8.27 * dpi);
        int wantH = (int)(11.69 * dpi);
        int maxW = Num(item.Properties, MAX_X);
        int maxH = Num(item.Properties, MAX_Y);

        Set(item.Properties, EXTENT_X, maxW > 0 ? Math.Min(wantW, maxW) : wantW);
        Set(item.Properties, EXTENT_Y, maxH > 0 ? Math.Min(wantH, maxH) : wantH);

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

    // Числовое свойство устройства. Ноль означает «драйвер не сообщил»
    static int Num(dynamic props, uint id)
    {
        try
        {
            foreach (dynamic p in props)
            {
                if ((uint)p.PropertyID != id) continue;
                return Convert.ToInt32(p.Value);
            }
        }
        catch { }
        return 0;
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