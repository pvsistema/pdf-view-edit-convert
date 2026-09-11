using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Съёмка напрямую через файл драйвера, минуя посредника Windows.
//
// Зачем. Аппарат вроде Kyocera TASKalfa 2020 виден в списке ТОЛЬКО
// потому, что мы открываем файл драйвера сами (DriverDirect). Посредник
// (TWAINDSM.dll / twain_32.dll) этот драйвер не перечисляет — значит и
// снять им ничего нельзя: при съёмке аппарат просто не находится, и
// человек видит «сканер не передал ни одной страницы».
//
// Здесь мы повторяем для съёмки то, что DriverDirect делает для списка:
// загружаем файл драйвера, открываем аппарат и проводим полный сеанс
// съёмки напрямую. Ровно так работает FineReader — поэтому у него
// этот же сканер снимает исправно.
internal static class DirectScan
{
    public static readonly List<string> Log = new();

    const uint DG_CONTROL = 0x0001;
    const uint DG_IMAGE = 0x0002;

    const ushort DAT_CAPABILITY = 0x0001;
    const ushort DAT_EVENT = 0x0002;
    const ushort DAT_IDENTITY = 0x0003;
    const ushort DAT_PENDINGXFERS = 0x0005;
    const ushort DAT_USERINTERFACE = 0x0009;
    const ushort DAT_IMAGENATIVEXFER = 0x0104;

    const ushort MSG_SET = 0x0006;
    const ushort MSG_GET = 0x0001;
    const ushort MSG_RESET = 0x0007;
    const ushort MSG_OPENDS = 0x0401;
    const ushort MSG_CLOSEDS = 0x0402;
    const ushort MSG_DISABLEDS = 0x0501;
    const ushort MSG_ENABLEDS = 0x0502;
    const ushort MSG_PROCESSEVENT = 0x0601;
    const ushort MSG_ENDXFER = 0x0701;

    const ushort MSG_XFERREADY = 0x0101;
    const ushort MSG_CLOSEDSREQ = 0x0102;

    const ushort TWRC_SUCCESS = 0;
    const ushort TWRC_CANCEL = 3;
    const ushort TWRC_DSEVENT = 4;
    const ushort TWRC_XFERDONE = 6;

    const ushort CAP_XFERCOUNT = 0x0001;
    const ushort ICAP_PIXELTYPE = 0x0101;
    const ushort ICAP_UNITS = 0x0102;
    const ushort ICAP_XFERMECH = 0x0103;
    const ushort ICAP_BITDEPTH = 0x112B;
    const ushort ICAP_XRESOLUTION = 0x1118;
    const ushort ICAP_YRESOLUTION = 0x1119;
    const ushort CAP_FEEDERENABLED = 0x1002;
    const ushort CAP_AUTOFEED = 0x1007;
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

    // У драйвера одна точка входа, но данные в неё передаются разные.
    // Для каждого вида — своя подпись, иначе поля читаются со сдвигом
    delegate ushort DsId(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwIdentity x);
    delegate ushort DsUi(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwUserInterface x);
    delegate ushort DsCap(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwCapability x);
    delegate ushort DsEv(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwEvent x);
    delegate ushort DsPend(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwPendingXfers x);
    delegate ushort DsPtr(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref IntPtr x);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string? path);

    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr h);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr h);

    [DllImport("user32.dll")] static extern bool GetMessage(out WinMsg m, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref WinMsg m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref WinMsg m);

    const uint WITH_ALTERED_PATH = 0x00000008;
    const uint SEARCH_DLL_DIR = 0x00000100;
    const uint SEARCH_DEFAULT_DIRS = 0x00001000;
    const uint GHND = 0x0042;

    // Снять страницы напрямую драйвером. Возвращает пути к картинкам.
    // Пустой список означает, что аппарат этим путём снять не удалось
    public static List<string> Scan(Twain.Options opt, string dir, Action<int, string>? onPage)
    {
        Log.Clear();
        var files = new List<string>();

        // Ищем файл драйвера, который знает наш аппарат. Заодно
        // запоминаем, по каким правилам он согласился отвечать
        string file = "";
        foreach (var d in DriverDirect.List())
        {
            if (string.IsNullOrWhiteSpace(opt.Device) ||
                string.Equals(d.Name, opt.Device, StringComparison.OrdinalIgnoreCase))
            {
                file = d.File;
                break;
            }
        }

        if (file.Length == 0)
        {
            Log.Add("прямая съёмка: файл драйвера для этого аппарата не найден");
            return files;
        }

        Log.Add("прямая съёмка: драйвер " + Path.GetFileName(file));

        // Правила старые/новые: аппарат отзывается только на своё
        foreach (bool oldRules in new[] { false, true })
        {
            try
            {
                var got = Session(file, oldRules, opt, dir, onPage);
                if (got.Count > 0) return got;
            }
            catch (Exception ex)
            {
                Log.Add("прямая съёмка: сбой — " + Short(ex));
            }
        }

        return files;
    }

    static List<string> Session(string file, bool oldRules, Twain.Options opt,
                                string dir, Action<int, string>? onPage)
    {
        Directory.CreateDirectory(dir);
        var files = new List<string>();
        string rules = oldRules ? "правила старые" : "правила новые";

        string folder = Path.GetDirectoryName(file) ?? "";
        SetDllDirectory(folder);

        IntPtr module = IntPtr.Zero;
        bool dsOpen = false, enabled = false;

        var app = MakeAppId(oldRules);
        var src = Blank();

        try
        {
            module = LoadLibraryEx(file, IntPtr.Zero,
                WITH_ALTERED_PATH | SEARCH_DLL_DIR | SEARCH_DEFAULT_DIRS);

            if (module == IntPtr.Zero)
            {
                Log.Add($"прямая съёмка: {rules} — драйвер не загружается");
                return files;
            }

            IntPtr entry = GetProcAddress(module, "DS_Entry");
            if (entry == IntPtr.Zero)
            {
                Log.Add($"прямая съёмка: {rules} — нет точки входа");
                return files;
            }

            var asId = Marshal.GetDelegateForFunctionPointer<DsId>(entry);
            var asUi = Marshal.GetDelegateForFunctionPointer<DsUi>(entry);
            var asCap = Marshal.GetDelegateForFunctionPointer<DsCap>(entry);
            var asEv = Marshal.GetDelegateForFunctionPointer<DsEv>(entry);
            var asPend = Marshal.GetDelegateForFunctionPointer<DsPend>(entry);
            var asPtr = Marshal.GetDelegateForFunctionPointer<DsPtr>(entry);

            // Открываем аппарат — здесь драйвер называет себя сам
            ushort rc = asId(ref app, ref src, DG_CONTROL, DAT_IDENTITY, MSG_OPENDS, ref src);
            if (rc != TWRC_SUCCESS)
            {
                Log.Add($"прямая съёмка: {rules} — аппарат не открывается (ответ {rc})");
                return files;
            }

            dsOpen = true;
            Log.Add($"прямая съёмка: {rules} — аппарат открыт");

            Setup(asCap, ref app, ref src, opt);

            IntPtr hwnd = Handle.Window;
            var ui = new TwUserInterface
            {
                ShowUI = (ushort)(opt.ShowUi ? 1 : 0),
                ModalUI = 0,
                hParent = hwnd,
            };

            rc = asUi(ref app, ref src, DG_CONTROL, DAT_USERINTERFACE, MSG_ENABLEDS, ref ui);
            if (rc != TWRC_SUCCESS && rc != 2)
            {
                Log.Add($"прямая съёмка: {rules} — аппарат не начал работу (ответ {rc})");
                return files;
            }

            enabled = true;

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 500;
            bool done = false;

            while (!done && GetMessage(out WinMsg m, IntPtr.Zero, 0, 0))
            {
                IntPtr raw = Marshal.AllocHGlobal(Marshal.SizeOf<WinMsg>());
                Marshal.StructureToPtr(m, raw, false);

                var ev = new TwEvent { pEvent = raw, TWMessage = 0 };
                ushort erc = asEv(ref app, ref src, DG_CONTROL, DAT_EVENT, MSG_PROCESSEVENT, ref ev);
                Marshal.FreeHGlobal(raw);

                if (erc != TWRC_DSEVENT)
                {
                    TranslateMessage(ref m);
                    DispatchMessage(ref m);
                    continue;
                }

                if (ev.TWMessage == MSG_CLOSEDSREQ) { done = true; break; }
                if (ev.TWMessage != MSG_XFERREADY) continue;

                var pend = new TwPendingXfers();
                do
                {
                    IntPtr img = IntPtr.Zero;
                    ushort trc = asPtr(ref app, ref src, DG_IMAGE, DAT_IMAGENATIVEXFER, MSG_GET, ref img);

                    if (trc == TWRC_XFERDONE && img != IntPtr.Zero)
                    {
                        made++;
                        string path = Path.Combine(dir, $"scan_{made:D3}.bmp");
                        SaveDib(img, path);
                        GlobalFree(img);

                        files.Add(path);
                        onPage?.Invoke(made, path);
                    }

                    pend = new TwPendingXfers();
                    asPend(ref app, ref src, DG_CONTROL, DAT_PENDINGXFERS, MSG_ENDXFER, ref pend);

                    if (trc == TWRC_CANCEL) { done = true; break; }
                    if (made >= cap) break;
                }
                while (pend.Count != 0);

                var rest = new TwPendingXfers();
                asPend(ref app, ref src, DG_CONTROL, DAT_PENDINGXFERS, MSG_RESET, ref rest);
                done = true;
            }

            Log.Add($"прямая съёмка: {rules} — листов снято {files.Count}");

            if (enabled)
            {
                var off = new TwUserInterface { ShowUI = 0, ModalUI = 0, hParent = hwnd };
                asUi(ref app, ref src, DG_CONTROL, DAT_USERINTERFACE, MSG_DISABLEDS, ref off);
                enabled = false;
            }

            if (dsOpen)
            {
                var closing = src;
                asId(ref app, ref src, DG_CONTROL, DAT_IDENTITY, MSG_CLOSEDS, ref closing);
                dsOpen = false;
            }

            return files;
        }
        finally
        {
            if (module != IntPtr.Zero) FreeLibrary(module);
            SetDllDirectory(null);
        }
    }

    // Настройки съёмки. Что аппарат не принял — пропускаем молча:
    // важнее получить лист, чем добиться точного качества
    static void Setup(DsCap call, ref TwIdentity app, ref TwIdentity src, Twain.Options opt)
    {
        One(call, ref app, ref src, ICAP_XFERMECH, TWTY_UINT16, TWSX_NATIVE);
        One(call, ref app, ref src, ICAP_UNITS, TWTY_UINT16, TWUN_INCHES);

        ushort pixel = opt.Color switch
        {
            "bw" => TWPT_BW,
            "gray" => TWPT_GRAY,
            _ => TWPT_RGB,
        };
        One(call, ref app, ref src, ICAP_PIXELTYPE, TWTY_UINT16, pixel);
        One(call, ref app, ref src, ICAP_BITDEPTH, TWTY_UINT16, opt.Color switch
        {
            "bw" => (ushort)1,
            "gray" => (ushort)8,
            _ => (ushort)24,
        });

        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));
        Raw(call, ref app, ref src, ICAP_XRESOLUTION, TWTY_FIX32, (uint)(ushort)dpi);
        Raw(call, ref app, ref src, ICAP_YRESOLUTION, TWTY_FIX32, (uint)(ushort)dpi);

        One(call, ref app, ref src, CAP_FEEDERENABLED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        One(call, ref app, ref src, CAP_AUTOFEED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        if (opt.Feeder)
            One(call, ref app, ref src, CAP_DUPLEXENABLED, TWTY_BOOL, (ushort)(opt.Duplex ? 1 : 0));

        One(call, ref app, ref src, CAP_XFERCOUNT, TWTY_INT16,
            opt.Limit > 0 ? (ushort)opt.Limit : unchecked((ushort)-1));
    }

    static void One(DsCap call, ref TwIdentity app, ref TwIdentity src, ushort cap, ushort type, ushort value)
        => Raw(call, ref app, ref src, cap, type, value);

    static void Raw(DsCap call, ref TwIdentity app, ref TwIdentity src, ushort cap, ushort type, uint value)
    {
        IntPtr h = GlobalAlloc(GHND, (UIntPtr)8);
        if (h == IntPtr.Zero) return;

        IntPtr p = GlobalLock(h);
        if (p == IntPtr.Zero) { GlobalFree(h); return; }

        Marshal.WriteInt16(p, 0, (short)type);
        Marshal.WriteInt32(p, 4, (int)value);
        GlobalUnlock(h);

        var c = new TwCapability { Cap = cap, ConType = TWON_ONEVALUE, hContainer = h };
        try { call(ref app, ref src, DG_CONTROL, DAT_CAPABILITY, MSG_SET, ref c); }
        catch { }

        GlobalFree(h);
    }

    // Драйвер отдаёт картинку куском памяти без заголовка файла.
    // Дописываем заголовок — получается обычный BMP
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
        finally
        {
            GlobalUnlock(hDib);
        }
    }

    static TwIdentity Blank() => new()
    {
        Version = new TwVersion { Info = Str32("") },
        Manufacturer = Str32(""),
        ProductFamily = Str32(""),
        ProductName = Str32(""),
    };

    static TwIdentity MakeAppId(bool oldRules) => new()
    {
        Id = 0,
        Version = new TwVersion
        {
            MajorNum = 1,
            MinorNum = 0,
            Language = 25,
            Country = 7,
            Info = Str32("1.0"),
        },
        ProtocolMajor = oldRules ? (ushort)1 : (ushort)2,
        ProtocolMinor = oldRules ? (ushort)9 : (ushort)1,
        SupportedGroups = DG_CONTROL | DG_IMAGE,
        Manufacturer = Str32("PV-Sistema"),
        ProductFamily = Str32("PV-Sistema PDF"),
        ProductName = Str32("PV-Sistema PDF"),
    };

    static byte[] Str32(string s)
    {
        var b = new byte[34];
        var raw = System.Text.Encoding.Default.GetBytes(s);
        Array.Copy(raw, b, Math.Min(raw.Length, 33));
        return b;
    }

    static string Short(Exception ex)
    {
        string m = ex.Message.Trim();
        int stop = m.IndexOf('\n');
        if (stop > 0) m = m.Substring(0, stop).Trim();
        if (m.Length > 160) m = m.Substring(0, 160) + "...";
        return m.Length > 0 ? m : ex.GetType().Name;
    }
}
