using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Общение со сканером по стандарту TWAIN — тому самому, которым
// пользуются программы производителей и FineReader. Драйвер такого
// сканера видит все устройства, даже те, о которых Windows не знает.
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
    const ushort TWTY_INT16 = 1;
    const ushort TWTY_UINT16 = 4;
    const ushort TWTY_BOOL = 6;
    const ushort TWTY_FIX32 = 7;

    const ushort TWPT_BW = 0;
    const ushort TWPT_GRAY = 1;
    const ushort TWPT_RGB = 2;
    const ushort TWSX_NATIVE = 0;
    const ushort TWUN_INCHES = 0;

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct TwVersion
    {
        public ushort MajorNum;
        public ushort MinorNum;
        public ushort Language;
        public ushort Country;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 34)] public byte[] Info;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
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

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct TwUserInterface
    {
        public ushort ShowUI;
        public ushort ModalUI;
        public IntPtr hParent;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct TwCapability
    {
        public ushort Cap;
        public ushort ConType;
        public IntPtr hContainer;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct TwEvent
    {
        public IntPtr pEvent;
        public ushort TWMessage;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
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

    // Какой диспетчер доступен на этом компьютере. Проверяем один раз
    static bool? _useNew;

    static bool UseNew()
    {
        if (_useNew.HasValue) return _useNew.Value;

        var probe = MakeAppId();
        try
        {
            IntPtr h = IntPtr.Zero;
            NewEntry(ref probe, IntPtr.Zero, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref h);
            _useNew = true;
        }
        catch { _useNew = false; }

        return _useNew.Value;
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
        ProtocolMajor = 2,
        ProtocolMinor = 1,
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
        var app = MakeAppId();
        IntPtr hwnd = Handle.Window;

        if (Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_OPENDSM, ref hwnd) != TWRC_SUCCESS)
            return found;

        try
        {
            var src = new TwIdentity();
            ushort rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETFIRST, ref src);

            while (rc == TWRC_SUCCESS)
            {
                string name = FromStr32(src.ProductName);
                if (!string.IsNullOrWhiteSpace(name))
                    found.Add(new Device { Name = name, HasFeeder = true, HasDuplex = true });

                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
                if (rc == TWRC_ENDOFLIST) break;
            }
        }
        finally
        {
            Dsm(ref app, DG_CONTROL, DAT_PARENT, MSG_CLOSEDSM, ref hwnd);
        }

        return found;
    }

    // Съёмка страниц. Возвращает пути к сохранённым картинкам
    public static List<string> Scan(Options opt, string dir, Action<int, string>? onPage = null)
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

            while (rc == TWRC_SUCCESS)
            {
                if (string.IsNullOrEmpty(opt.Device) || FromStr32(src.ProductName) == opt.Device)
                {
                    picked = true;
                    break;
                }
                src = new TwIdentity();
                rc = Dsm(ref app, DG_CONTROL, DAT_IDENTITY, MSG_GETNEXT, ref src);
                if (rc == TWRC_ENDOFLIST) break;
            }

            if (!picked)
                throw new InvalidOperationException("Сканер не найден среди устройств TWAIN.");

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
                string title = cap switch
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