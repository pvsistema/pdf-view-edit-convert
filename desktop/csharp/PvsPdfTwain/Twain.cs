using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Общение со сканером по стандарту TWAIN — тому самому, которым
// пользуются программы производителей и FineReader. Драйвер такого
// сканера видит все устройства, даже те, о которых Windows не знает.
// Нужного аппарата нет у этого посредника. Отдельный вид ошибки нужен,
// чтобы отличить «спроси другого» от настоящей поломки сканера
internal sealed class DeviceNotFoundException : Exception
{
    public DeviceNotFoundException(string message) : base(message) { }
}

internal static class Twain
{
    // ---- группы, разделы и команды стандарта ----
    const uint DG_CONTROL = 0x0001;
    const uint DG_IMAGE = 0x0002;

    const ushort DAT_CAPABILITY = 0x0001;
    const ushort DAT_EVENT = 0x0002;
    const ushort DAT_IDENTITY = 0x0003;
    const ushort DAT_PARENT = 0x0004;
    const ushort DAT_PENDINGXFERS = 0x0005;
    const ushort DAT_USERINTERFACE = 0x0009;
    const ushort DAT_IMAGENATIVEXFER = 0x0104;

    const ushort MSG_GET = 0x0001;
    const ushort MSG_SET = 0x0006;
    const ushort MSG_OPENDSM = 0x0301;
    const ushort MSG_CLOSEDSM = 0x0302;
    const ushort MSG_OPENDS = 0x0401;
    const ushort MSG_CLOSEDS = 0x0402;
    const ushort MSG_GETFIRST = 0x0004;
    const ushort MSG_GETNEXT = 0x0005;
    const ushort MSG_DISABLEDS = 0x0501;
    const ushort MSG_ENABLEDS = 0x0502;
    const ushort MSG_PROCESSEVENT = 0x0601;
    const ushort MSG_ENDXFER = 0x0701;
    const ushort MSG_RESET = 0x0007;

    const ushort MSG_XFERREADY = 0x0101;
    const ushort MSG_CLOSEDSREQ = 0x0102;

    const ushort TWRC_SUCCESS = 0;
    const ushort TWRC_CANCEL = 3;
    const ushort TWRC_DSEVENT = 4;
    const ushort TWRC_XFERDONE = 6;
    const ushort TWRC_ENDOFLIST = 7;

    // ---- свойства съёмки ----
    const ushort CAP_XFERCOUNT = 0x0001;
    const ushort ICAP_PIXELTYPE = 0x0101;
    const ushort ICAP_UNITS = 0x0102;
    const ushort ICAP_XFERMECH = 0x0103;
    const ushort ICAP_BITDEPTH = 0x112B;
    const ushort ICAP_XRESOLUTION = 0x1118;
    const ushort ICAP_YRESOLUTION = 0x1119;
    const ushort CAP_FEEDERENABLED = 0x1002;
    const ushort CAP_AUTOFEED = 0x1007;
    const ushort CAP_DUPLEX = 0x1012;
    const ushort CAP_DUPLEXENABLED = 0x1013;

    const ushort TWON_ONEVALUE = 5;
    // Виды ответа драйвера о возможностях: список значений и диапазон
    const ushort TWON_ENUMERATION = 3;
    const ushort TWON_RANGE = 6;
    const ushort TWTY_INT16 = 1;
    const ushort TWTY_UINT16 = 4;
    const ushort TWTY_BOOL = 6;
    const ushort TWTY_FIX32 = 7;

    const ushort TWPT_BW = 0;
    const ushort TWPT_GRAY = 1;
    const ushort TWPT_RGB = 2;
    const ushort TWSX_NATIVE = 0;
    const ushort TWUN_INCHES = 0;

    // Как плотно укладываются поля структур при обмене с драйвером.
    // Стандарт TWAIN требует разного в разных разрядностях (twain.h):
    //   32 разряда -> pack 2
    //   64 разряда -> pack 8
    // Значение выбирается при сборке: помощник собирается дважды.
    // С неверным значением драйвер и помощник читают одни и те же
    // данные по-разному — имя сканера приходит мусором, список пуст
#if TWAIN64
    const int PACK = 8;
#else
    const int PACK = 2;
#endif

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwVersion
    {
        public ushort MajorNum;
        public ushort MinorNum;
        public ushort Language;
        public ushort Country;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 34)] public byte[] Info;
    }

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwIdentity
    {
        public uint Id;
        public TwVersion Version;
        public ushort ProtocolMajor;
        public ushort ProtocolMinor;
        public uint SupportedGroups;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 34)] public byte[] Manufacturer;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 34)] public byte[] ProductFamily;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 34)] public byte[] ProductName;
    }

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwUserInterface
    {
        public ushort ShowUI;
        public ushort ModalUI;
        public IntPtr hParent;
    }

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwCapability
    {
        public ushort Cap;
        public ushort ConType;
        public IntPtr hContainer;
    }

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwEvent
    {
        public IntPtr pEvent;
        public ushort TWMessage;
    }

    [StructLayout(LayoutKind.Sequential, Pack = PACK)]
    struct TwPendingXfers
    {
        public ushort Count;
        public uint EOJ;
    }


    [StructLayout(LayoutKind.Sequential)]
    struct WinMsg
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    // Диспетчер TWAIN. Ищем сначала современный, затем классический
    const string DSM_NEW = "TWAINDSM.dll";
    const string DSM_OLD = "twain_32.dll";

    // Windows не поставляет современный диспетчер (TWAINDSM.dll) и не ищет
    // его сама: в системных папках его нет. Кладут его драйверы —
    // в C:\Windows\twain_64 у 64-разрядных, в twain_32 у 32-разрядных.
    //
    // Без этой подсказки 64-разрядный помощник не находил диспетчер вовсе
    // и возвращал пустой список: классический twain_32.dll ему не подходит
    // по разрядности. Из-за этого пропадали Kyocera и другие современные МФУ
    static Twain()
    {
        NativeLibrary.SetDllImportResolver(typeof(Twain).Assembly, (name, asm, path) =>
        {
            if (!name.Equals(DSM_NEW, StringComparison.OrdinalIgnoreCase))
                return IntPtr.Zero;

            foreach (string candidate in DsmPaths())
            {
                if (!File.Exists(candidate)) continue;
                if (NativeLibrary.TryLoad(candidate, out IntPtr lib)) return lib;
            }

            return IntPtr.Zero;
        });
    }

    // Где искать современный диспетчер. Порядок важен: сначала папка своей
    // разрядности, затем рядом с программой, и только потом общесистемные
    static IEnumerable<string> DsmPaths()
    {
        string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string mine = Environment.Is64BitProcess ? "twain_64" : "twain_32";

        yield return Path.Combine(win, mine, DSM_NEW);
        yield return Path.Combine(AppContext.BaseDirectory, DSM_NEW);

        // Некоторые драйверы кладут диспетчер в системную папку.
        // Для 32-разрядного помощника на 64-разрядной Windows это SysWOW64
        yield return Path.Combine(win,
            Environment.Is64BitProcess ? "System32" : "SysWOW64", DSM_NEW);
    }

    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, IntPtr d, uint dg, ushort dat, ushort msg, ref TwIdentity data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, IntPtr d, uint dg, ushort dat, ushort msg, ref IntPtr data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwUserInterface data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwCapability data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwEvent data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwPendingXfers data);
    [DllImport(DSM_NEW, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort NewEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref IntPtr data);

    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, IntPtr d, uint dg, ushort dat, ushort msg, ref TwIdentity data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, IntPtr d, uint dg, ushort dat, ushort msg, ref IntPtr data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwUserInterface data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwCapability data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwEvent data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwPendingXfers data);
    [DllImport(DSM_OLD, EntryPoint = "DSM_Entry", CharSet = CharSet.Ansi)]
    static extern ushort OldEntry(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref IntPtr data);

    // Сколько драйверов не отозвалось при последнем опросе. Раньше
    // такой драйвер обрывал перебор — теперь только считается
    public static int Skipped;

    // Какой диспетчер доступен на этом компьютере. Проверяем один раз
    static bool? _useNew;

    // Каким посредником пользуемся прямо сейчас. Пусто — выбрать самим
    static bool? _force;

    // На время работы переключаемся на нужного посредника
    static void Force(bool useNew) => _force = useNew;
    static void Unforce() => _force = null;

    static bool UseNew()
    {
        if (_force.HasValue) return _force.Value;
        if (_useNew.HasValue) return _useNew.Value;

        var probe = MakeAppId();
        try
        {
            IntPtr h = IntPtr.Zero;
            NewEntry(ref probe, IntPtr.Zero, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref h);
            _useNew = true;
        }
        catch
        {
            // Классический диспетчер (twain_32.dll) существует только
            // в 32 разрядах. В 64-разрядном помощнике откатываться некуда:
            // честно признаём, что работать не с чем
            _useNew = false;
        }

        return _useNew.Value;
    }

    // Проверка, отзывается ли посредник этого вида. Проверяем самим
    // открытием: библиотека может быть на месте, но не работать
    static bool Works(bool useNew)
    {
        // Классический посредник существует только в 32 разрядах
        if (!useNew && Environment.Is64BitProcess) return false;

        Force(useNew);
        try
        {
            var probe = MakeAppId();
            IntPtr hwnd = Handle.Window;

            if (NewOrOld(ref probe, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
                return false;

            NewOrOld(ref probe, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
            return true;
        }
        catch { return false; }
        finally { Unforce(); }
    }

    static ushort NewOrOld(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref IntPtr data)
        => UseNew() ? NewEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data)
                    : OldEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data);

    // Каких посредников есть смысл спрашивать. Спрашиваем ОБОИХ:
    // современный (TWAINDSM.dll) перечисляет не все драйверы — старые
    // вроде Kyocera KMTWAIN он молча пропускает, а классический
    // twain_32.dll их показывает. По одному посреднику аппарат терялся
    static List<bool> Dsms()
    {
        var list = new List<bool>();
        if (Works(true)) list.Add(true);
        if (Works(false)) list.Add(false);
        return list;
    }

    // Есть ли на компьютере диспетчер, пригодный для этой разрядности.
    // 64 разряда обслуживает только современный TWAINDSM.dll
    public static bool DsmReady() => UseNew() || !Environment.Is64BitProcess;

    // Отчёт о самопроверке: что помощник видит на этом компьютере.
    // Нужен, когда сканер не находится и надо понять, на каком шаге
    // обрывается цепочка — без догадок и переустановок вслепую
    public static Dictionary<string, object> SelfTest()
    {
        var report = new Dictionary<string, object>
        {
            ["bits"] = Environment.Is64BitProcess ? 64 : 32,
            ["pack"] = PACK,
        };

        // Где искали современный диспетчер и что нашли
        var looked = new List<string>();
        string dsmFound = "";
        foreach (string candidate in DsmPaths())
        {
            bool exists = File.Exists(candidate);
            looked.Add((exists ? "есть: " : "нет:  ") + candidate);
            if (exists && dsmFound.Length == 0) dsmFound = candidate;
        }

        report["dsmSearched"] = looked;
        report["dsmFound"] = dsmFound;
        report["dsmNew"] = UseNew();
        report["dsmReady"] = DsmReady();

        // Какие драйверы вообще лежат в папке своей разрядности
        var drivers = new List<string>();
        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string dir = Path.Combine(win, Environment.Is64BitProcess ? "twain_64" : "twain_32");
            if (Directory.Exists(dir))
                foreach (string sub in Directory.GetDirectories(dir))
                {
                    // Имя папки для необычного пути может не определиться
                    string? folder = Path.GetFileName(sub);
                    if (!string.IsNullOrEmpty(folder)) drivers.Add(folder);
                }
        }
        catch (Exception ex) { drivers.Add("не прочитать: " + ex.Message); }

        report["driverFolders"] = drivers;

        // И что отвечает сам опрос
        try
        {
            var found = List();
            report["scanners"] = found
                .Select(d => d.Name
                    + (_via.TryGetValue(d.Name, out bool v)
                        ? (v ? "  [современный" : "  [классический") : "  [")
                    + (_rules.TryGetValue(d.Name, out bool r)
                        ? (r ? ", правила старые]" : ", правила новые]") : "]"))
                .ToList();
            report["skipped"] = Skipped;
        }
        catch (Exception ex)
        {
            report["scannersError"] = ex.Message;
        }

        // Служба Windows своей разрядности. Её тоже спрашивает помощник:
        // 64-разрядная программа не видит 32-разрядные драйверы службы,
        // а именно такие идут у части МФУ
        try
        {
            report["wiaReady"] = Wia.Ready();
            report["wiaScanners"] = Wia.List().Select(d => d.Name).ToList();
        }
        catch (Exception ex)
        {
            report["wiaError"] = ex.Message;
        }

        // Пошаговый разбор по каждому сочетанию «посредник + правила»:
        // видно, кто какие драйверы показывает и на что отзывается
        // конкретный аппарат
        var walk = new List<string>();
        foreach (bool useNew in new[] { true, false })
        {
            string title = useNew ? "современный (TWAINDSM.dll)" : "классический (twain_32.dll)";

            if (!Works(useNew)) { walk.Add(title + ": не отзывается"); continue; }

            foreach (bool oldRules in new[] { false, true })
            {
                walk.Add(title + ", правила " + (oldRules ? "старые 1.9" : "новые 2.1") + ":");
                Force(useNew);
                Rules(oldRules);
                try { foreach (string step in Walk()) walk.Add("   " + step); }
                catch (Exception ex) { walk.Add("   сбой: " + ex.Message); }
                finally { Unforce(); Rules(false); }
            }
        }

        report["walk"] = walk;

        return report;
    }

    // Подробный обход драйверов: имя и код ответа на каждом шаге
    static List<string> Walk()
    {
        var steps = new List<string>();

        var app = MakeAppId();
        IntPtr hwnd = Handle.Window;

        if (Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
        {
            steps.Add("не удалось открыть диспетчер");
            return steps;
        }

        try
        {
            var src = new TwIdentity();
            ushort rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETFIRST, ref src);

            for (int i = 0; i < 64; i++)
            {
                if (rc == TWRC_ENDOFLIST) { steps.Add("список кончился"); break; }

                if (rc == TWRC_SUCCESS)
                    steps.Add("ответ 0 (успех): " + FromStr32(src.ProductName));
                else
                    steps.Add("ответ " + rc + " (отказ) — пропускаем, идём дальше");

                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
            }
        }
        catch (Exception ex) { steps.Add("сбой: " + ex.Message); }
        finally
        {
            Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
        }

        return steps;
    }

    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr h);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr h);

    [DllImport("user32.dll")] static extern bool GetMessage(out WinMsg m, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref WinMsg m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref WinMsg m);

    const uint GHND = 0x0042;

    static byte[] Str32(string s)
    {
        var buf = new byte[34];
        var src = System.Text.Encoding.Default.GetBytes(s);
        Array.Copy(src, buf, Math.Min(src.Length, 33));
        return buf;
    }

    static string FromStr32(byte[] b)
    {
        int n = Array.IndexOf(b, (byte)0);
        return System.Text.Encoding.Default.GetString(b, 0, n < 0 ? b.Length : n).Trim();
    }

    // Кто мы такие в терминах стандарта — сканер видит это имя
    // По каким правилам представляемся драйверу. Старые драйверы
    // современные правила не поддерживают и программам, которые их
    // просят, себя НЕ показывают — просто молчат. Так терялась Kyocera:
    // ABBYY FineReader 12 просит старые правила и видит её прекрасно.
    // Поэтому спрашиваем дважды — и по новым, и по старым
    static bool _oldRules;

    static void Rules(bool old) => _oldRules = old;

    static TwIdentity MakeAppId() => new()
    {
        Id = 0,
        Version = new TwVersion
        {
            MajorNum = 1,
            MinorNum = 0,
            Language = 25,       // русский
            Country = 7,         // Россия
            Info = Str32("1.0"),
        },
        ProtocolMajor = _oldRules ? (ushort)1 : (ushort)2,
        ProtocolMinor = _oldRules ? (ushort)9 : (ushort)1,
        SupportedGroups = DG_CONTROL | DG_IMAGE,
        Manufacturer = Str32("PV-Sistema"),
        ProductFamily = Str32("PV-Sistema PDF"),
        ProductName = Str32("PV-Sistema PDF"),
    };

    public sealed class Device
    {
        public string Name = "";
        public bool HasFeeder;
        public bool HasDuplex;
    }

    public sealed class Options
    {
        public string Device = "";
        public int Dpi = 300;
        public string Color = "color";
        public bool Feeder;
        public bool Duplex;
        public int Limit;
        public bool ShowUi;
    }

    // ---- обёртки над диспетчером ----
    static ushort Dsm(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwIdentity data)
        => UseNew() ? NewEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data)
                    : OldEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data);

    static ushort Dsm(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref IntPtr data)
        => UseNew() ? NewEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data)
                    : OldEntry(ref app, IntPtr.Zero, dg, dat, msg, ref data);

    static ushort Ds(ref TwIdentity app, ref TwIdentity src, uint dg, ushort dat, ushort msg, ref TwUserInterface d)
        => UseNew() ? NewEntry(ref app, ref src, dg, dat, msg, ref d)
                    : OldEntry(ref app, ref src, dg, dat, msg, ref d);

    static ushort Ds(ref TwIdentity app, ref TwIdentity src, uint dg, ushort dat, ushort msg, ref TwCapability d)
        => UseNew() ? NewEntry(ref app, ref src, dg, dat, msg, ref d)
                    : OldEntry(ref app, ref src, dg, dat, msg, ref d);

    static ushort Ds(ref TwIdentity app, ref TwIdentity src, uint dg, ushort dat, ushort msg, ref TwEvent d)
        => UseNew() ? NewEntry(ref app, ref src, dg, dat, msg, ref d)
                    : OldEntry(ref app, ref src, dg, dat, msg, ref d);

    static ushort Ds(ref TwIdentity app, ref TwIdentity src, uint dg, ushort dat, ushort msg, ref TwPendingXfers d)
        => UseNew() ? NewEntry(ref app, ref src, dg, dat, msg, ref d)
                    : OldEntry(ref app, ref src, dg, dat, msg, ref d);

    static ushort Ds(ref TwIdentity app, ref TwIdentity src, uint dg, ushort dat, ushort msg, ref IntPtr d)
        => UseNew() ? NewEntry(ref app, ref src, dg, dat, msg, ref d)
                    : OldEntry(ref app, ref src, dg, dat, msg, ref d);

    // Список сканеров, известных драйверам TWAIN
    public static List<Device> List()
    {
        var found = new List<Device>();
        Skipped = 0;

        // Спрашиваем каждого посредника ДВАЖДЫ — по современным правилам
        // и по старым. Старые драйверы (Kyocera) современные правила не
        // понимают и на такой запрос себя не показывают, поэтому одного
        // прохода не хватало. Ответы складываем
        foreach (bool useNew in Dsms())
            foreach (bool oldRules in new[] { false, true })
            {
                Force(useNew);
                Rules(oldRules);
                try
                {
                    foreach (var dev in ListVia())
                    {
                        if (found.Any(d => string.Equals(d.Name, dev.Name, StringComparison.OrdinalIgnoreCase)))
                            continue;

                        _via[dev.Name] = useNew;
                        _rules[dev.Name] = oldRules;
                        found.Add(dev);
                    }
                }
                catch { }
                finally { Unforce(); Rules(false); }
            }

        return found;
    }

    // По каким правилам отозвался аппарат. Снимать его нужно так же
    static readonly Dictionary<string, bool> _rules = new(StringComparer.OrdinalIgnoreCase);

    // Через какого посредника нашёлся аппарат. Снимать его нужно
    // тем же: другой посредник о нём может не знать
    static readonly Dictionary<string, bool> _via = new(StringComparer.OrdinalIgnoreCase);

    static List<Device> ListVia()
    {
        var found = new List<Device>();
        var app = MakeAppId();
        IntPtr hwnd = Handle.Window;

        if (Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
            return found;

        try
        {
            var src = new TwIdentity();
            ushort rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETFIRST, ref src);

            // Перебираем ВСЕХ, а не до первого несогласного.
            //
            // Раньше цикл заканчивался на любом ответе, кроме успеха, —
            // и капризный драйвер уносил с собой все стоящие после него.
            // Так пропадала Kyocera: её KMTWAIN идёт вторым, после Epson,
            // и на запрос отвечает отказом, когда аппарат не отзывается.
            //
            // Теперь отказ пропускаем и спрашиваем следующего. Признак
            // конца — только «список кончился» либо предохранитель по счёту
            for (int guard = 0; guard < 64; guard++)
            {
                if (rc == TWRC_ENDOFLIST) break;

                if (rc == TWRC_SUCCESS)
                {
                    string name = FromStr32(src.ProductName);
                    if (!string.IsNullOrWhiteSpace(name) &&
                        !found.Any(d => string.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase)))
                        found.Add(new Device { Name = name, HasFeeder = true, HasDuplex = true });
                }
                else
                {
                    // Драйвер занят, не загрузился или ответил ошибкой.
                    // Это не повод терять остальные аппараты
                    Skipped++;
                }

                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
            }
        }
        finally
        {
            Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
        }

        return found;
    }

    // Какое качество умеет аппарат. Драйвер отвечает либо списком
    // значений, либо диапазоном «от и до с шагом» — разбираем оба вида.
    // Пустой ответ означает «узнать не удалось»: тогда показываем
    // обычный набор значений, ничего не запрещая
    public static List<int> Resolutions(string deviceName)
    {
        if (!DsmReady()) return new List<int>();

        // Помощник запускается заново на каждую команду, поэтому как
        // аппарат отозвался — уже неизвестно. Перебираем все сочетания
        foreach (var way in Order(deviceName))
        {
            Force(way.UseNew);
            Rules(way.OldRules);
            try
            {
                var list = ResolutionsVia(deviceName);
                if (list.Count > 0) return list;
            }
            catch { }
            finally { Unforce(); Rules(false); }
        }

        return new List<int>();
    }

    // Сочетание «посредник + правила»: аппарат отзывается только на
    // своё, поэтому перебираем все четыре пары
    public readonly struct Way
    {
        public readonly bool UseNew;
        public readonly bool OldRules;
        public Way(bool useNew, bool oldRules) { UseNew = useNew; OldRules = oldRules; }
    }

    // В каком порядке пробовать. Если помним, как аппарат отозвался
    // при опросе, — начинаем с этого сочетания
    static List<Way> Order(string deviceName)
    {
        var all = new List<Way>();
        foreach (bool useNew in Dsms())
            foreach (bool oldRules in new[] { false, true })
                all.Add(new Way(useNew, oldRules));

        if (!string.IsNullOrWhiteSpace(deviceName) &&
            _via.TryGetValue(deviceName, out bool v) &&
            _rules.TryGetValue(deviceName, out bool r))
        {
            int i = all.FindIndex(w => w.UseNew == v && w.OldRules == r);
            if (i > 0)
            {
                var best = all[i];
                all.RemoveAt(i);
                all.Insert(0, best);
            }
        }

        return all;
    }

    static List<int> ResolutionsVia(string deviceName)
    {
        var list = new List<int>();
        var app = MakeAppId();
        IntPtr hwnd = Handle.Window;

        if (Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
            return list;

        bool dsOpen = false;
        var src = new TwIdentity();

        try
        {
            ushort rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETFIRST, ref src);
            bool picked = false;

            // Ответ-отказ пропускаем и идём дальше: иначе капризный
            // драйвер закрывает собой все аппараты, стоящие после него
            for (int guard = 0; guard < 64; guard++)
            {
                if (rc == TWRC_ENDOFLIST) break;

                if (rc == TWRC_SUCCESS &&
                    FromStr32(src.ProductName).Equals(deviceName, StringComparison.OrdinalIgnoreCase))
                {
                    picked = true;
                    break;
                }

                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
            }

            if (!picked) return list;
            if (Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_OPENDS, ref src) != TWRC_SUCCESS)
                return list;

            dsOpen = true;
            ReadCap(ref app, ref src, ICAP_XRESOLUTION, list);
        }
        catch { }
        finally
        {
            if (dsOpen) Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_CLOSEDS, ref src);
            Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
        }

        list.Sort();
        return list;
    }

    // Разбор ответа драйвера о поддерживаемых значениях
    static void ReadCap(ref TwIdentity app, ref TwIdentity src, ushort cap, List<int> into)
    {
        var c = new TwCapability { Cap = cap, ConType = 0, hContainer = IntPtr.Zero };
        if (Ds(ref app, ref src, DG_CONTROL, DAT_CAPABILITY, MSG_GET, ref c) != TWRC_SUCCESS)
            return;
        if (c.hContainer == IntPtr.Zero) return;

        IntPtr p = GlobalLock(c.hContainer);
        if (p == IntPtr.Zero) { GlobalFree(c.hContainer); return; }

        try
        {
            // После поля типа (2 байта) идёт выравнивание: в 32 разрядах
            // следующее поле начинается сразу, в 64 — с отступом.
            // Раньше смещения были записаны числами для 32 разрядов,
            // и 64-разрядный помощник читал качество не с того места
            int head = PACK >= 4 ? 4 : 2;

            // Список значений: тип, сколько их, текущее, по умолчанию, дальше сами значения
            if (c.ConType == TWON_ENUMERATION)
            {
                ushort type = (ushort)Marshal.ReadInt16(p, 0);
                int count = Marshal.ReadInt32(p, head);
                int first = head + 12;
                for (int i = 0; i < count && i < 64; i++)
                    into.Add(ReadItem(p, first + i * ItemSize(type), type));
            }
            // Диапазон: от, до, с шагом
            else if (c.ConType == TWON_RANGE)
            {
                ushort type = (ushort)Marshal.ReadInt16(p, 0);
                int size = ItemSize(type);
                int min = ReadItem(p, head, type);
                int max = ReadItem(p, head + size, type);
                int step = Math.Max(1, ReadItem(p, head + size * 2, type));

                for (int v = min; v <= max && into.Count < 64; v += step)
                    into.Add(v);
            }
            else if (c.ConType == TWON_ONEVALUE)
            {
                // Здесь отступ одинаков в обеих разрядностях: так это
                // поле читалось и раньше, и с ним сканеры отвечают верно
                ushort type = (ushort)Marshal.ReadInt16(p, 0);
                into.Add(ReadItem(p, 4, type));
            }
        }
        catch { }
        finally
        {
            GlobalUnlock(c.hContainer);
            GlobalFree(c.hContainer);
        }

        into.RemoveAll(v => v < 50 || v > 2400);
        var uniq = new List<int>(new SortedSet<int>(into));
        into.Clear();
        into.AddRange(uniq);
    }

    static int ItemSize(ushort type) => type == TWTY_FIX32 ? 4 : 2;

    // Дробное число стандарта: целая часть лежит в младших двух байтах
    static int ReadItem(IntPtr p, int at, ushort type) =>
        type == TWTY_FIX32
            ? (short)Marshal.ReadInt16(p, at)
            : (ushort)Marshal.ReadInt16(p, at);

    // Съёмка страниц. Возвращает пути к сохранённым картинкам
    public static List<string> Scan(Options opt, string dir, Action<int, string>? onPage = null)
    {
        if (!DsmReady())
            throw new InvalidOperationException(
                "На этом компьютере нет 64-разрядной службы TWAIN. Обычно её ставит драйвер сканера — переустановите драйвер производителя.");

        // Аппарат отзывается только на своё сочетание посредника и
        // правил. Пробуем по очереди: «сканер не найден» — повод
        // попробовать следующее, а другая беда касается уже аппарата
        var tried = Order(opt.Device);
        for (int i = 0; i < tried.Count; i++)
        {
            Force(tried[i].UseNew);
            Rules(tried[i].OldRules);
            try { return ScanVia(opt, dir, onPage); }
            catch (DeviceNotFoundException) when (i < tried.Count - 1) { }
            finally { Unforce(); Rules(false); }
        }

        throw new InvalidOperationException("Сканер не найден среди устройств TWAIN.");
    }

    static List<string> ScanVia(Options opt, string dir, Action<int, string>? onPage)
    {
        Directory.CreateDirectory(dir);
        var files = new List<string>();

        var app = MakeAppId();
        IntPtr hwnd = Handle.Window;

        if (Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
            throw new InvalidOperationException("Не удалось запустить службу TWAIN на этом компьютере.");

        bool dsmOpen = true;
        bool dsOpen = false;
        bool enabled = false;
        var src = new TwIdentity();

        try
        {
            // Ищем нужный сканер по имени
            ushort rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETFIRST, ref src);
            bool picked = false;

            // Как и при опросе: отказ одного драйвера не должен
            // мешать добраться до нужного аппарата
            for (int guard = 0; guard < 64; guard++)
            {
                if (rc == TWRC_ENDOFLIST) break;

                if (rc == TWRC_SUCCESS &&
                    (string.IsNullOrEmpty(opt.Device) || FromStr32(src.ProductName) == opt.Device))
                {
                    picked = true;
                    break;
                }

                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
            }

            if (!picked)
                throw new DeviceNotFoundException("Сканер не найден среди устройств TWAIN.");

            if (Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_OPENDS, ref src) != TWRC_SUCCESS)
                throw new InvalidOperationException(
                    "Драйвер сканера не смог связаться с аппаратом. " +
                    "У сетевых МФУ адрес аппарата задаётся в настройках самого драйвера: " +
                    "откройте «Пуск → программы производителя → настройка сканера» " +
                    "и проверьте, что устройство там добавлено и доступно. " +
                    "Также убедитесь, что аппарат включён и не занят другой программой.");

            dsOpen = true;
            Setup(ref app, ref src, opt);

            // Родное окно драйвера показываем только по просьбе
            var ui = new TwUserInterface
            {
                ShowUI = (ushort)(opt.ShowUi ? 1 : 0),
                ModalUI = 0,
                hParent = hwnd,
            };

            rc = Ds(ref app, ref src, DG_CONTROL, DAT_USERINTERFACE, MSG_ENABLEDS, ref ui);
            if (rc != TWRC_SUCCESS && rc != TWRC_CHECK)
                throw new InvalidOperationException("Сканер не начал работу. Проверьте, что он включён и не занят.");

            enabled = true;

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 500;
            bool done = false;

            // Ждём сообщений от драйвера: он сам скажет, когда лист готов
            while (!done && GetMessage(out WinMsg m, IntPtr.Zero, 0, 0))
            {
                IntPtr raw = Marshal.AllocHGlobal(Marshal.SizeOf<WinMsg>());
                Marshal.StructureToPtr(m, raw, false);

                var ev = new TwEvent { pEvent = raw, TWMessage = 0 };
                ushort erc = Ds(ref app, ref src, DG_CONTROL, DAT_EVENT, MSG_PROCESSEVENT, ref ev);
                Marshal.FreeHGlobal(raw);

                if (erc != TWRC_DSEVENT)
                {
                    TranslateMessage(ref m);
                    DispatchMessage(ref m);
                    continue;
                }

                if (ev.TWMessage == MSG_CLOSEDSREQ)
                {
                    done = true;
                    break;
                }

                if (ev.TWMessage != MSG_XFERREADY) continue;

                // Забираем готовые листы, пока драйвер их отдаёт
                var pend = new TwPendingXfers();
                do
                {
                    IntPtr img = IntPtr.Zero;
                    ushort trc = Ds(ref app, ref src, DG_IMAGE, DAT_IMAGENATIVEXFER, MSG_GET, ref img);

                    if (trc == TWRC_XFERDONE && img != IntPtr.Zero)
                    {
                        made++;
                        string path = Path.Combine(dir, $"scan_{made:D3}.bmp");
                        SaveDib(img, path);
                        GlobalFree(img);

                        files.Add(path);
                        onPage?.Invoke(made, path);
                    }

                    // Сообщаем драйверу, что лист принят
                    pend = new TwPendingXfers();
                    Ds(ref app, ref src, DG_CONTROL, DAT_PENDINGXFERS, MSG_ENDXFER, ref pend);

                    if (trc == TWRC_CANCEL) { done = true; break; }
                    if (made >= cap) break;
                }
                while (pend.Count != 0);

                // Остатки в очереди сбрасываем, чтобы драйвер освободился
                var rest = new TwPendingXfers();
                Ds(ref app, ref src, DG_CONTROL, DAT_PENDINGXFERS, MSG_RESET, ref rest);
                done = true;
            }

            if (files.Count == 0)
                throw new InvalidOperationException(
                    opt.Feeder
                        ? "Сканер не передал ни одного листа. Проверьте бумагу в автоподатчике."
                        : "Сканер не передал изображение. Проверьте, что документ лежит на стекле.");

            return files;
        }
        finally
        {
            if (enabled)
            {
                var ui = new TwUserInterface { ShowUI = 0, ModalUI = 0, hParent = hwnd };
                Ds(ref app, ref src, DG_CONTROL, DAT_USERINTERFACE, MSG_DISABLEDS, ref ui);
            }
            if (dsOpen) Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_CLOSEDS, ref src);
            if (dsmOpen) Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
        }
    }

    const ushort TWRC_CHECK = 2;

    // Настройки съёмки. Часть сканеров понимает не всё —
    // такие свойства пропускаем, чтобы не срывать работу
    static void Setup(ref TwIdentity app, ref TwIdentity src, Options opt)
    {
        refused.Clear();
        SetOne(ref app, ref src, ICAP_XFERMECH, TWTY_UINT16, TWSX_NATIVE);
        SetOne(ref app, ref src, ICAP_UNITS, TWTY_UINT16, TWUN_INCHES);

        ushort pixel = opt.Color switch
        {
            "bw" => TWPT_BW,
            "gray" => TWPT_GRAY,
            _ => TWPT_RGB,
        };
        SetOne(ref app, ref src, ICAP_PIXELTYPE, TWTY_UINT16, pixel);
        SetOne(ref app, ref src, ICAP_BITDEPTH, TWTY_UINT16, opt.Color switch
        {
            "bw" => (ushort)1,
            "gray" => (ushort)8,
            _ => (ushort)24,
        });

        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));
        SetFix(ref app, ref src, ICAP_XRESOLUTION, dpi);
        SetFix(ref app, ref src, ICAP_YRESOLUTION, dpi);

        // Автоподатчик и двусторонняя съёмка
        SetOne(ref app, ref src, CAP_FEEDERENABLED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        SetOne(ref app, ref src, CAP_AUTOFEED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        if (opt.Feeder)
            SetOne(ref app, ref src, CAP_DUPLEXENABLED, TWTY_BOOL, (ushort)(opt.Duplex ? 1 : 0));

        // Сколько листов брать: -1 означает «пока есть бумага»
        SetOne(ref app, ref src, CAP_XFERCOUNT, TWTY_INT16,
            opt.Limit > 0 ? (ushort)opt.Limit : unchecked((ushort)-1));
    }

    // Какие настройки сканер не принял — пригодится, чтобы объяснить
    // человеку, почему снимок вышел не таким, как он просил
    static readonly List<string> refused = new();

    public static string[] Refused() => refused.ToArray();

    static void SetOne(ref TwIdentity app, ref TwIdentity src, ushort cap, ushort type, ushort value)
        => SetRaw(ref app, ref src, cap, type, value);

    // Дробное число стандарта: младшие 2 байта — целая часть,
    // старшие — доля. Разрешение всегда целое, поэтому доля нулевая
    static void SetFix(ref TwIdentity app, ref TwIdentity src, ushort cap, int whole)
        => SetRaw(ref app, ref src, cap, TWTY_FIX32, (uint)(ushort)whole);

    // Настройка передаётся драйверу так: сначала тип (2 байта), затем
    // само значение. Значение начинается не сразу за типом, а с отступа
    // в 4 байта — этого требует выравнивание памяти. Если записать его
    // вплотную, драйвер прочитает мусор, промолчит и возьмёт своё
    // значение по умолчанию: именно поэтому сканер игнорировал
    // выбранное качество и всегда работал на 300 точках
    static void SetRaw(ref TwIdentity app, ref TwIdentity src, ushort cap, ushort type, uint value)
    {
        IntPtr mem = GlobalAlloc(GHND, (UIntPtr)8);
        if (mem == IntPtr.Zero) return;

        try
        {
            IntPtr p = GlobalLock(mem);
            if (p == IntPtr.Zero) return;

            Marshal.WriteInt16(p, 0, (short)type);
            Marshal.WriteInt16(p, 2, 0);
            Marshal.WriteInt32(p, 4, (int)value);
            GlobalUnlock(mem);

            var c = new TwCapability { Cap = cap, ConType = TWON_ONEVALUE, hContainer = mem };
            ushort rc = Ds(ref app, ref src, DG_CONTROL, DAT_CAPABILITY, MSG_SET, ref c);

            // TWRC_CHECKSTATUS означает «взял, но по-своему» — это нормально.
            // Всё остальное, кроме успеха, — отказ, и о нём стоит помнить
            if (rc != TWRC_SUCCESS && rc != TWRC_CHECK)
            {
                // Знак вопроса означает: название может и не найтись —
                // для настроек, о которых человеку сообщать нечего
                string? title = cap switch
                {
                    ICAP_XRESOLUTION or ICAP_YRESOLUTION => "качество (точек на дюйм)",
                    ICAP_PIXELTYPE => "цветность",
                    ICAP_BITDEPTH => "глубина цвета",
                    CAP_FEEDERENABLED or CAP_AUTOFEED => "автоподатчик",
                    CAP_DUPLEXENABLED => "двусторонняя съёмка",
                    CAP_XFERCOUNT => "количество листов",
                    _ => null,
                };
                if (title != null && !refused.Contains(title)) refused.Add(title);
            }
        }
        catch { }
        finally { GlobalFree(mem); }
    }

    // Драйвер отдаёт картинку в виде куска памяти с описанием точек.
    // Дописываем к нему заголовок файла — получается обычный BMP
    static void SaveDib(IntPtr hDib, string path)
    {
        IntPtr p = GlobalLock(hDib);
        if (p == IntPtr.Zero) throw new InvalidOperationException("Сканер отдал пустое изображение.");

        try
        {
            int headerSize = Marshal.ReadInt32(p, 0);
            int bitCount = Marshal.ReadInt16(p, 14);
            int usedColors = Marshal.ReadInt32(p, 32);
            int compression = Marshal.ReadInt32(p, 16);

            int palette = bitCount <= 8
                ? (usedColors > 0 ? usedColors : 1 << bitCount) * 4
                : 0;

            // Часть драйверов описывает цвета масками — их тоже учитываем
            if (compression == 3) palette += 12;

            int total = (int)GlobalSize(hDib);
            int offset = 14 + headerSize + palette;

            using var fs = new FileStream(path, FileMode.Create, FileAccess.Write);
            using var w = new BinaryWriter(fs);

            w.Write((byte)'B');
            w.Write((byte)'M');
            w.Write(14 + total);
            w.Write((short)0);
            w.Write((short)0);
            w.Write(offset);

            var buf = new byte[total];
            Marshal.Copy(p, buf, 0, total);
            w.Write(buf);
        }
        finally { GlobalUnlock(hDib); }
    }
}