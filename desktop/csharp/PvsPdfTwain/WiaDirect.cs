using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Прямой разговор со службой сканирования Windows, без посредника.
//
// Зачем. Обычно к службе обращаются через готовую надстройку (её ставит
// сам Windows). Но эта надстройка старая, и на части компьютеров она
// отвечает «устройств ноль» даже тогда, когда сканер исправен, включён
// и записан в системе — ровно наш случай с Kyocera.
//
// Здесь мы спрашиваем службу так же, как это делают «Факсы и
// сканирование» и программы вроде FineReader: напрямую. Надстройка
// в этой цепочке не участвует, и её причуды нам больше не мешают.
//
// Спрашиваем ДВАЖДЫ — по новым правилам и по старым. Драйверы,
// выпущенные до 2015 года, часто отвечают только на старые.
internal static class WiaDirect
{
    // Пошаговый рассказ о последнем поиске — идёт прямо в отчёт
    public static readonly List<string> Log = new();

    public sealed class Device
    {
        public string Id = "";
        public string Name = "";
    }

    // ---- как Windows описывает устройство ----

    // Сканер. Камеры и видео нас не интересуют
    const uint TYPE_SCANNER = 0x00000001;
    const uint TYPE_MASK = 0x000000FF;

    // Свойства устройства в списке
    const uint PROP_ID = 2;      // код устройства
    const uint PROP_NAME = 4;    // название
    const uint PROP_TYPE = 6;    // тип: сканер, камера, видео

    const ushort VT_I4 = 3;
    const ushort VT_BSTR = 8;

    [ComImport]
    [Guid("5e38b83c-8cf1-11d1-bf92-0060081ed811")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IWiaDevMgr
    {
        // Нам нужен только перечислитель устройств. Остальные методы
        // объявлены заглушками, чтобы порядок в таблице не сбился —
        // Windows находит метод по его номеру, а не по имени
        [PreserveSig] int EnumDeviceInfo(int flags, out IEnumWIA_DEV_INFO items);
        [PreserveSig] int CreateDevice();
        [PreserveSig] int SelectDeviceDlg();
        [PreserveSig] int SelectDeviceDlgID();

        // Просит Windows снять страницу и сохранить её в файл.
        // Всю работу с драйвером служба берёт на себя
        [PreserveSig] int GetImageDlg(
            IntPtr parent, int deviceType, int flags, int intent,
            IntPtr rootItem, [MarshalAs(UnmanagedType.BStr)] string file, ref Guid format);
        [PreserveSig] int RegisterEventCallbackProgram();
        [PreserveSig] int RegisterEventCallbackInterface();
        [PreserveSig] int RegisterEventCallbackCLSID();
        [PreserveSig] int AddDeviceDlg();
    }

    // Новое поколение службы. Порядок методов у него ДРУГОЙ, поэтому
    // и описание нужно своё: в прошлый раз я объявил новый знак, но
    // оставил старое описание — отсюда и был «сбой преобразования»
    [ComImport]
    [Guid("79c07cf1-cbdd-41ee-8ec3-f00080cada7a")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IWiaDevMgr2
    {
        [PreserveSig] int EnumDeviceInfo(int flags, out IEnumWIA_DEV_INFO items);
        [PreserveSig] int CreateDevice();
        [PreserveSig] int SelectDeviceDlg();
        [PreserveSig] int SelectDeviceDlgID();
        [PreserveSig] int RegisterEventCallbackProgram();
        [PreserveSig] int RegisterEventCallbackInterface();
        [PreserveSig] int RegisterEventCallbackCLSID();
        [PreserveSig] int GetImageDlg();
    }

    [ComImport]
    [Guid("5e8383fc-3391-11d2-9a33-00c04fa36145")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IEnumWIA_DEV_INFO
    {
        [PreserveSig] int Next(uint count, out IWiaPropertyStorage item, out uint taken);
        [PreserveSig] int Skip(uint count);
        [PreserveSig] int Reset();
        [PreserveSig] int Clone(out IEnumWIA_DEV_INFO copy);
        [PreserveSig] int GetCount(out uint count);
    }

    [ComImport]
    [Guid("98b5e8a0-29cc-491a-aac0-e6db4fdcceb6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IWiaPropertyStorage
    {
        [PreserveSig] int ReadMultiple(uint count, [In] PROPSPEC[] spec, [Out] PROPVARIANT[] value);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROPSPEC
    {
        public uint Kind;      // 1 — обращаемся по номеру свойства
        public IntPtr Value;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROPVARIANT
    {
        public ushort Type;
        public ushort Pad1, Pad2, Pad3;
        public IntPtr Value;
        public IntPtr Value2;
    }

    [DllImport("ole32.dll")]
    static extern int CoCreateInstance(
        ref Guid clsid, IntPtr outer, uint context, ref Guid iid, out IntPtr result);

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PROPVARIANT pv);

    const uint INPROC_SERVER = 1;
    const uint LOCAL_SERVER = 4;

    // Служба существует в двух поколениях. Спрашиваем оба: старое
    // понимают все драйверы, новое — только свежие
    static readonly Guid CLSID_OLD = new("a1f4e726-8cf1-11d1-bf92-0060081ed811");
    static readonly Guid CLSID_NEW = new("b6c292bc-7c88-41ee-8b54-8ec92617e599");

    // У каждого поколения службы СВОЙ опознавательный знак. Спросишь
    // у нового старый — получишь отказ 80004002 «нет такого
    // интерфейса». Именно на этом прошлая попытка и споткнулась
    static readonly Guid IID_DEVMGR = new("5e38b83c-8cf1-11d1-bf92-0060081ed811");
    static readonly Guid IID_DEVMGR2 = new("79c07cf1-cbdd-41ee-8ec3-f00080cada7a");

    // «Дай себя в общем виде» — с этого начинает рабочая программа
    static readonly Guid IID_UNKNOWN = new("00000000-0000-0000-c000-000000000046");

    // Все сканеры, известные службе Windows
    public static List<Device> List()
    {
        var found = new List<Device>();
        Log.Clear();

        // Порядок важен: сначала старое поколение — его понимают
        // и старые драйверы, и новые. Новое спрашиваем следом,
        // на случай аппарата, который отзывается только ему
        Ask(CLSID_OLD, IID_DEVMGR, "правила старые", found);
        Ask(CLSID_NEW, IID_DEVMGR2, "правила новые", found);

        Log.Add("итого сканеров: " + found.Count);
        return found;
    }

    static void Ask(Guid clsid, Guid interfaceId, string title, List<Device> found)
    {
        IntPtr raw = IntPtr.Zero;

        try
        {
            var id = clsid;
            var iid = interfaceId;

            // Приём, подсмотренный у рабочей программы (ABBYY ScanWia):
            // службу берут СНАЧАЛА «в общем виде», и только потом
            // отдельным шагом уточняют нужный интерфейс.
            //
            // Мы раньше требовали интерфейс сразу при создании — и если
            // служба на этом шаге капризничала, получали отказ 80004002
            // и уходили ни с чем. Теперь у нас две попытки вместо одной
            var iidUnknown = IID_UNKNOWN;

            int hr = CoCreateInstance(ref id, IntPtr.Zero, INPROC_SERVER | LOCAL_SERVER, ref iidUnknown, out raw);

            if (hr != 0 || raw == IntPtr.Zero)
            {
                Log.Add($"{title}: служба не создалась в общем виде (код {hr:X8})");

                // Запасной путь — старый способ, сразу с интерфейсом
                hr = CoCreateInstance(ref id, IntPtr.Zero, INPROC_SERVER | LOCAL_SERVER, ref iid, out raw);
                if (hr != 0 || raw == IntPtr.Zero)
                {
                    Log.Add($"{title}: и напрямую не отозвалась (код {hr:X8})");
                    return;
                }

                Log.Add($"{title}: создалась напрямую");
            }
            else
            {
                Log.Add($"{title}: служба создана, уточняем интерфейс");

                // Отдельный шаг: спрашиваем нужный интерфейс у уже
                // созданной службы
                int ask = Marshal.QueryInterface(raw, ref iid, out IntPtr typed);
                if (ask == 0 && typed != IntPtr.Zero)
                {
                    Marshal.Release(raw);
                    raw = typed;
                    Log.Add($"{title}: интерфейс получен");
                }
                else
                {
                    Log.Add($"{title}: интерфейс не отдан (код {ask:X8})");
                    return;
                }
            }

            // У каждого поколения службы своё описание. Берём подходящее:
            // спросить новую службу по старому описанию нельзя.
            //
            // Приводить надо СРАЗУ к нужному описанию. Через общий вид
            // (GetObjectForIUnknown) Windows подбирает описание сама и
            // ошибается — отсюда был сбой «Specified cast is not valid»
            // ровно после успешного получения интерфейса
            IEnumWIA_DEV_INFO? items;
            int step0;
            object mgr;

            if (interfaceId == IID_DEVMGR2)
            {
                var typed = (IWiaDevMgr2)Marshal.GetTypedObjectForIUnknown(raw, typeof(IWiaDevMgr2));
                mgr = typed;
                step0 = typed.EnumDeviceInfo(0, out items);
            }
            else
            {
                var typed = (IWiaDevMgr)Marshal.GetTypedObjectForIUnknown(raw, typeof(IWiaDevMgr));
                mgr = typed;
                step0 = typed.EnumDeviceInfo(0, out items);
            }

            if (step0 != 0 || items == null)
            {
                Log.Add($"{title}: список устройств не получен (код {step0:X8})");
                Release(mgr);
                return;
            }

            uint total = 0;
            try { items.GetCount(out total); } catch { }
            Log.Add($"{title}: устройств {total}");

            int number = 0;
            while (true)
            {
                int step = items.Next(1, out IWiaPropertyStorage item, out uint taken);
                if (step != 0 || taken == 0) break;

                number++;
                try
                {
                    var dev = Read(item, number, title);
                    if (dev == null) continue;

                    // Один аппарат отзывается обоим поколениям —
                    // показываем его один раз
                    if (found.Any(d => string.Equals(d.Id, dev.Id, StringComparison.OrdinalIgnoreCase)))
                        continue;

                    found.Add(dev);
                }
                finally { Release(item); }
            }

            Release(items);
            Release(mgr);
        }
        catch (Exception ex) { Log.Add($"{title}: сбой — " + Short(ex)); }
        finally { if (raw != IntPtr.Zero) Marshal.Release(raw); }
    }

    // Название, код и тип устройства
    static Device? Read(IWiaPropertyStorage item, int number, string title)
    {
        var spec = new PROPSPEC[3];
        var value = new PROPVARIANT[3];

        spec[0].Kind = 1; spec[0].Value = (IntPtr)PROP_ID;
        spec[1].Kind = 1; spec[1].Value = (IntPtr)PROP_NAME;
        spec[2].Kind = 1; spec[2].Value = (IntPtr)PROP_TYPE;

        int hr = item.ReadMultiple(3, spec, value);
        if (hr != 0 && hr != 1)   // 1 — часть свойств не отдана, это допустимо
        {
            Log.Add($"   № {number}: свойства не прочитать (код {hr:X8})");
            return null;
        }

        try
        {
            string id = Text(value[0]);
            string name = Text(value[1]);
            uint type = (uint)Number(value[2]);

            // Тип читаем мягко: часть драйверов его не сообщает.
            // Отбрасываем только заведомо не сканер
            if (type != 0 && (type & TYPE_MASK) != TYPE_SCANNER)
            {
                Log.Add($"   № {number}: пропущен, не сканер");
                return null;
            }

            if (string.IsNullOrWhiteSpace(id))
            {
                Log.Add($"   № {number}: пропущен, устройство без кода");
                return null;
            }

            if (string.IsNullOrWhiteSpace(name)) name = "Сканер";

            Log.Add($"   № {number}: {Pretty(name)}");
            return new Device { Id = id, Name = Pretty(name) };
        }
        finally
        {
            for (int i = 0; i < value.Length; i++)
                try { PropVariantClear(ref value[i]); } catch { }
        }
    }

    static string Text(PROPVARIANT v)
        => v.Type == VT_BSTR && v.Value != IntPtr.Zero
            ? Marshal.PtrToStringBSTR(v.Value) ?? ""
            : "";

    static int Number(PROPVARIANT v)
        => v.Type == VT_I4 ? (int)v.Value : 0;

    // Убираем из названия служебные слова драйвера: человеку нужен
    // «Kyocera TASKalfa 2020», а не «Kyocera TASKalfa 2020 WIA Driver #3»
    public static string Pretty(string name)
    {
        string s = name.Trim();

        // Windows добавляет номер копии: «... WIA Driver #3»
        int hash = s.LastIndexOf('#');
        if (hash > 0 && int.TryParse(s.Substring(hash + 1).Trim(), out _))
            s = s.Substring(0, hash).Trim();

        foreach (string tail in new[] { " WIA Driver", " WIA-Driver", " WIA driver", " TWAIN Driver", " WIA" })
        {
            if (s.EndsWith(tail, StringComparison.OrdinalIgnoreCase))
                s = s.Substring(0, s.Length - tail.Length).Trim();
        }

        return s.Length > 0 ? s : name;
    }

    // Съёмка силами самой службы Windows. Нужна там, где старая
    // надстройка сканер не видит: служба открывает своё окно, снимает
    // страницу и кладёт её в файл — драйвером занимается она сама
    public static string? ScanToFile(string path)
    {
        IntPtr raw = IntPtr.Zero;

        // Только старое поколение. У нового окно съёмки объявлено
        // в другом порядке, и вызов по чужой таблице обрушил бы
        // программу — а список устройств мы и так спрашиваем у обоих
        foreach (var pair in new[] { (CLSID_OLD, IID_DEVMGR) })
        {
            try
            {
                var id = pair.Item1;
                var iid = pair.Item2;

                int hr = CoCreateInstance(ref id, IntPtr.Zero, INPROC_SERVER | LOCAL_SERVER, ref iid, out raw);
                if (hr != 0 || raw == IntPtr.Zero) continue;

                // Приводим сразу к нужному описанию: через общий вид
                // Windows подбирает его сама и ошибается
                var mgr = (IWiaDevMgr)Marshal.GetTypedObjectForIUnknown(raw, typeof(IWiaDevMgr));
                var format = FORMAT_BMP;

                // 1 — сканер, 0 — без лишних окон выбора
                int step = mgr.GetImageDlg(IntPtr.Zero, 1, 0, 0, IntPtr.Zero, path, ref format);
                Release(mgr);

                if (step == 0 && File.Exists(path)) return null;

                // 1 — человек закрыл окно, ничего не сняв
                if (step == 1) return "Съёмка отменена.";
            }
            catch (Exception ex) { Log.Add("прямая съёмка: " + Short(ex)); }
            finally
            {
                if (raw != IntPtr.Zero) { Marshal.Release(raw); raw = IntPtr.Zero; }
            }
        }

        return "Служба Windows не смогла получить снимок.";
    }

    static Guid FORMAT_BMP = new("b96b3cab-0728-11d3-9d7b-0000f81ef32e");

    static string Short(Exception ex)
    {
        string m = ex.Message.Trim();
        int stop = m.IndexOf('\n');
        if (stop > 0) m = m.Substring(0, stop).Trim();
        if (m.Length > 160) m = m.Substring(0, 160) + "...";
        return m.Length > 0 ? m : ex.GetType().Name;
    }

    static void Release(object? com)
    {
        try { if (com != null && Marshal.IsComObject(com)) Marshal.ReleaseComObject(com); }
        catch { }
    }
}
