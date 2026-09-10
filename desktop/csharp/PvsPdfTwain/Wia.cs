using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Работа со сканером через службу Windows (WIA).
//
// Зачем это внутри помощника, ведь служба есть и в главной программе.
// Помощник собирается и 32-, и 64-разрядным, и спрашивает службу из
// обоих. Часть драйверов капризничает в одной разрядности и спокойно
// отвечает в другой, поэтому два независимых опроса надёжнее одного.
//
// Главное здесь — не молчать. Каждый шаг поиска записывается в Log:
// сколько устройств насчитала служба, какие пропущены и почему. Раньше
// ошибки гасились молча, и пустой список нечем было объяснить.
internal static class Wia
{
    // Свойства снимка в терминах службы Windows
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

    const int WANT_COLOR = 0x00000001;
    const int WANT_GRAY = 0x00000002;
    const int WANT_TEXT = 0x00000004;

    const int DATA_THRESHOLD = 0;   // ч/б, одна точка — один бит
    const int DATA_GRAY = 2;
    const int DATA_COLOR = 3;

    const int FEEDER = 0x001;
    const int FLATBED = 0x002;
    const int DUPLEX = 0x004;

    const string JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
    const string BMP = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";

    public sealed class Device
    {
        public string Id = "";
        public string Name = "";
        public bool HasFeeder;
        public bool HasDuplex;
    }

    // Отзывается ли служба на этом компьютере
    public static bool Ready() => MakeCom("WIA.DeviceManager") != null;

    // Состояние службы «Загрузка изображений (WIA)». Она может быть
    // остановлена или отключена — тогда посредник создаётся как ни в чём
    // не бывало, а список аппаратов приходит пустым. Без этой проверки
    // пустой список выглядел загадкой
    public static string ServiceState()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine
                .OpenSubKey(@"SYSTEM\CurrentControlSet\Services\stisvc");

            if (key == null) return "службы stisvc нет в системе";

            int start = Convert.ToInt32(key.GetValue("Start") ?? 4);
            string mode = start switch
            {
                2 => "запуск автоматический",
                3 => "запуск вручную",
                4 => "ОТКЛЮЧЕНА",
                _ => "режим запуска " + start,
            };

            return mode;
        }
        catch (Exception ex) { return "не прочитать: " + Short(ex); }
    }

    // Сканеры, зарегистрированные в реестре Windows. Независимая
    // проверка: если аппарат здесь есть, а служба его не отдала —
    // значит дело в самой службе, а не в отсутствии драйвера
    public static List<string> Registered()
    {
        var list = new List<string>();

        try
        {
            using var root = Microsoft.Win32.Registry.LocalMachine
                .OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{6bdd1fc6-810f-11d0-bec7-08002be2092f}");

            if (root == null) return list;

            foreach (string sub in root.GetSubKeyNames())
            {
                // Внутри лежат и служебные разделы вроде Properties
                if (!int.TryParse(sub, out _)) continue;

                try
                {
                    using var item = root.OpenSubKey(sub);
                    string? name = item?.GetValue("FriendlyName") as string
                                ?? item?.GetValue("DriverDesc") as string;

                    if (!string.IsNullOrWhiteSpace(name)) list.Add(Pretty(name!));
                }
                catch { }
            }
        }
        catch (Exception ex) { list.Add("не прочитать реестр: " + Short(ex)); }

        return list;
    }

    // Пошаговый рассказ о последнем поиске: сколько устройств насчитала
    // служба, какие пропущены и почему. Раньше все ошибки гасились молча,
    // и пустой список приходилось объяснять догадками
    public static readonly List<string> Log = new();

    // Сканеры, известные службе Windows
    public static List<Device> List() => Sta(ListCore);

    static List<Device> ListCore()
    {
        var found = new List<Device>();
        dynamic? mgr = null;
        Log.Clear();

        try
        {
            mgr = MakeCom("WIA.DeviceManager");
            if (mgr == null)
            {
                Log.Add("служба не создалась: WIA.DeviceManager недоступен");
                return found;
            }

            // Перебираем по номеру, а не единым списком: капризный
            // драйвер обрывает общий перебор целиком, и вместе с ним
            // теряются исправные сканеры, стоящие в списке дальше
            int count = -1;
            try { count = (int)mgr.DeviceInfos.Count; }
            catch (Exception ex) { Log.Add("не сосчитать устройства: " + Short(ex)); }

            Log.Add("служба насчитала устройств: " + (count < 0 ? "не удалось" : count.ToString()));

            for (int i = 1; i <= count; i++)
            {
                dynamic? info = null;
                try
                {
                    info = mgr.DeviceInfos[i];
                    var dev = ReadDevice(info, i);
                    if (dev != null) found.Add(dev);
                }
                catch (Exception ex) { Log.Add($"   № {i}: не прочитать — " + Short(ex)); }
                finally { Release(info); }
            }

            // Номера не подошли — пробуем обычным перебором.
            // Лучше неполный список, чем пустой
            if (found.Count == 0 && count != 0)
            {
                Log.Add("по номерам ничего не вышло, пробуем обычным перебором");
                try
                {
                    int k = 0;
                    foreach (dynamic info in mgr.DeviceInfos)
                    {
                        k++;
                        try
                        {
                            var dev = ReadDevice(info, k);
                            if (dev != null) found.Add(dev);
                        }
                        catch (Exception ex) { Log.Add($"   № {k}: не прочитать — " + Short(ex)); }
                    }
                }
                catch (Exception ex) { Log.Add("перебор оборвался: " + Short(ex)); }
            }

            Log.Add("итого сканеров: " + found.Count);
        }
        catch (Exception ex) { Log.Add("сбой поиска: " + Short(ex)); }
        finally { Release(mgr); }

        return found;
    }

    // Короткая суть ошибки: длинные технические простыни в отчёте
    // только мешают читать
    static string Short(Exception ex)
    {
        string m = ex.Message.Trim();
        int stop = m.IndexOf('\n');
        if (stop > 0) m = m.Substring(0, stop).Trim();
        if (m.Length > 160) m = m.Substring(0, 160) + "...";
        return m.Length > 0 ? m : ex.GetType().Name;
    }

    // Сведения об одном устройстве. Отсекаем только заведомо чужое:
    // камеры и видеоустройства
    static Device? ReadDevice(dynamic info, int number)
    {
        int type = -1;
        try { type = (int)info.Type; }
        catch (Exception ex) { Log.Add($"   № {number}: тип не сообщён — " + Short(ex)); }

        if (type == 2 || type == 3)
        {
            Log.Add($"   № {number}: пропущен, это " + (type == 2 ? "камера" : "видеоустройство"));
            return null;
        }

        string id = "";
        try { id = (string)info.DeviceID; }
        catch (Exception ex) { Log.Add($"   № {number}: нет кода устройства — " + Short(ex)); }

        string name = "";
        try { name = Prop(info.Properties, "Name") ?? ""; }
        catch (Exception ex) { Log.Add($"   № {number}: нет названия — " + Short(ex)); }

        if (string.IsNullOrWhiteSpace(id))
        {
            Log.Add($"   № {number}: пропущен, устройство без кода");
            return null;
        }
        if (string.IsNullOrWhiteSpace(name)) name = "Сканер";

        Log.Add($"   № {number}: {Pretty(name)}");

        int caps = 0;
        try { caps = Convert.ToInt32(Prop(info.Properties, "Document Handling Capabilities") ?? "0"); }
        catch { }

        return new Device
        {
            Id = id,
            Name = Pretty(name),
            HasFeeder = (caps & FEEDER) != 0,
            HasDuplex = (caps & DUPLEX) != 0,
        };
    }

    // Убираем из названия служебные слова драйвера: человеку нужен
    // «Kyocera TASKalfa 2020», а не «Kyocera TASKalfa 2020 WIA Driver»
    static string Pretty(string name)
    {
        string s = name.Trim();
        foreach (string tail in new[] { " WIA Driver", " WIA-Driver", " WIA driver", " TWAIN Driver" })
        {
            if (s.EndsWith(tail, StringComparison.OrdinalIgnoreCase))
                s = s.Substring(0, s.Length - tail.Length).Trim();
        }
        return s.Length > 0 ? s : name;
    }

    // Съёмка. Возвращает пути к сохранённым картинкам
    public static List<string> Scan(Twain.Options opt, string dir, Action<int, string>? onPage)
        => Sta(() => ScanCore(opt, dir, onPage));

    static List<string> ScanCore(Twain.Options opt, string dir, Action<int, string>? onPage)
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
                int type = -1;
                try { type = (int)d.Type; } catch { }
                if (type == 2 || type == 3) continue;

                string id = "";
                try { id = (string)d.DeviceID; } catch { }

                string name = "";
                try { name = Prop(d.Properties, "Name") ?? ""; } catch { }

                // Ищем и по коду устройства, и по названию: помощник
                // запускается заново на каждую команду, и главная
                // программа передаёт то, что показывала человеку
                if (string.IsNullOrWhiteSpace(opt.Device) ||
                    string.Equals(id, opt.Device, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, opt.Device, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(Pretty(name), opt.Device, StringComparison.OrdinalIgnoreCase))
                {
                    info = d;
                    break;
                }
            }

            if (info == null)
                throw new DeviceNotFoundException("Сканер не найден среди устройств Windows.");

            device = info.Connect();
            dynamic item = device.Items[1];

            Prepare(device, item, opt);

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 200;

            while (made < cap)
            {
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
                onPage?.Invoke(made, path);

                // Со стекла берём ровно один лист. Из автоподатчика
                // идём до конца пачки
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
    static void Prepare(dynamic device, dynamic item, Twain.Options opt)
    {
        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));

        // Сначала пожелание к снимку, потом всё остальное: драйвер в ответ
        // сам подбирает глубину цвета, и порядок здесь важен
        int intent = opt.Color switch
        {
            "bw" => WANT_TEXT,
            "gray" => WANT_GRAY,
            _ => WANT_COLOR,
        };
        Set(item.Properties, INTENT, intent);

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

    // Служба работает только в однопоточном режиме COM (STA). Из обычного
    // фонового потока часть драйверов не отвечает и устройство «исчезает»
    static T Sta<T>(Func<T> work)
    {
        T result = default!;
        Exception? error = null;

        var thread = new Thread(() =>
        {
            try { result = work(); }
            catch (Exception ex) { error = ex; }
        });

        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join();

        if (error != null) throw error;
        return result;
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