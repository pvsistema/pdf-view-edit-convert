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
    const ushort ICAP_SUPPORTEDSIZES = 0x111A;
    const ushort TWSS_A4 = 4;

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
    // Для каждого вида — своя подпись, иначе поля читаются со сдвигом.
    //
    // ГЛАВНАЯ ТОНКОСТЬ. У файла драйвера и у посредника точки входа
    // РАЗНЫЕ. Стандарт требует от драйвера пять частей вопроса:
    //     DS_Entry(кто спрашивает, группа, раздел, команда, данные)
    // а у посредника их шесть — между «кто» и «группой» он ждёт ещё
    // «кого спрашиваем». Раньше я звал драйвер как посредника: лишняя
    // часть сдвигала все остальные, драйвер читал мусор и отвечал
    // отказом. Теперь пробуем обе формы и берём ту, на которую аппарат
    // отозвался — старые драйверы встречаются обеих разновидностей
    delegate ushort DsId5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref TwIdentity x);
    delegate ushort DsUi5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref TwUserInterface x);
    delegate ushort DsCap5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref TwCapability x);
    delegate ushort DsEv5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref TwEvent x);
    delegate ushort DsPend5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref TwPendingXfers x);
    delegate ushort DsPtr5(ref TwIdentity o, uint dg, ushort dat, ushort msg, ref IntPtr x);

    delegate ushort DsId(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwIdentity x);
    delegate ushort DsUi(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwUserInterface x);
    delegate ushort DsCap(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwCapability x);
    delegate ushort DsEv(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwEvent x);
    delegate ushort DsPend(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref TwPendingXfers x);
    delegate ushort DsPtr(ref TwIdentity o, ref TwIdentity d, uint dg, ushort dat, ushort msg, ref IntPtr x);

    // Разговор с драйвером в выбранной форме. Какая форма верная —
    // выясняется при открытии аппарата, дальше весь сеанс идёт ею
    sealed class Talk
    {
        public bool Short;          // пятичастная форма (по стандарту)
        public TwIdentity Dest;     // «кого спрашиваем» — для шестичастной

        public DsId5? Id5; public DsUi5? Ui5; public DsCap5? Cap5;
        public DsEv5? Ev5; public DsPend5? Pend5; public DsPtr5? Ptr5;

        public DsId? Id6; public DsUi? Ui6; public DsCap? Cap6;
        public DsEv? Ev6; public DsPend? Pend6; public DsPtr? Ptr6;

        public ushort Id(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwIdentity x)
            => Short ? Id5!(ref app, dg, dat, msg, ref x)
                     : Id6!(ref app, ref Dest, dg, dat, msg, ref x);

        public ushort Ui(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwUserInterface x)
            => Short ? Ui5!(ref app, dg, dat, msg, ref x)
                     : Ui6!(ref app, ref Dest, dg, dat, msg, ref x);

        public ushort Cap(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwCapability x)
            => Short ? Cap5!(ref app, dg, dat, msg, ref x)
                     : Cap6!(ref app, ref Dest, dg, dat, msg, ref x);

        public ushort Ev(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwEvent x)
            => Short ? Ev5!(ref app, dg, dat, msg, ref x)
                     : Ev6!(ref app, ref Dest, dg, dat, msg, ref x);

        public ushort Pend(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref TwPendingXfers x)
            => Short ? Pend5!(ref app, dg, dat, msg, ref x)
                     : Pend6!(ref app, ref Dest, dg, dat, msg, ref x);

        public ushort Ptr(ref TwIdentity app, uint dg, ushort dat, ushort msg, ref IntPtr x)
            => Short ? Ptr5!(ref app, dg, dat, msg, ref x)
                     : Ptr6!(ref app, ref Dest, dg, dat, msg, ref x);
    }

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
    [DllImport("user32.dll")] static extern bool PeekMessage(out WinMsg m, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjects(uint count, IntPtr[]? handles, bool all, uint ms, uint mask);
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

        // Какие файлы драйверов пробовать. Сначала тот, что назвался
        // именем выбранного аппарата, затем — все остальные.
        //
        // Перебор важен: имя в списке могло прийти от службы Windows
        // или быть вписано человеком вручную, и тогда точного совпадения
        // с именем внутри драйвера просто нет. Сдаваться на этом нельзя —
        // сканер на компьютере один, и снять надо им
        var order = new List<string>();

        try
        {
            foreach (var d in DriverDirect.List())
            {
                // Сверяем по сути, а не буква в букву: драйвер зовёт
                // аппарат «Kyocera TASKalfa 2020 TWAIN», а в списке у
                // человека — «Kyocera TASKalfa 2020»
                if (!string.IsNullOrWhiteSpace(opt.Device) &&
                    Twain.Plain(d.Name) == Twain.Plain(opt.Device))
                    order.Insert(0, d.File);
                else if (!order.Contains(d.File))
                    order.Add(d.File);
            }
        }
        catch (Exception ex) { Log.Add("прямая съёмка: опрос драйверов не удался — " + Short(ex)); }

        // Драйвер мог не назваться при опросе, но снимать — уметь.
        // Поэтому добавляем и те файлы, что просто лежат на месте
        foreach (string f in DriverFiles())
            if (!order.Contains(f)) order.Add(f);

        if (order.Count == 0)
        {
            Log.Add("прямая съёмка: файлов драйверов на компьютере не найдено");
            return files;
        }

        foreach (string file in order)
        {
            Log.Add("прямая съёмка: пробую драйвер " + Path.GetFileName(file));

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
        }

        return files;
    }

    // Файлы драйверов своей разрядности, лежащие в папках Windows
    static List<string> DriverFiles()
    {
        var files = new List<string>();

        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string root = Path.Combine(win, Environment.Is64BitProcess ? "twain_64" : "twain_32");
            if (!Directory.Exists(root)) return files;

            foreach (string dir in Directory.GetDirectories(root))
            {
                try
                {
                    foreach (string f in Directory.GetFiles(dir, "*.ds", SearchOption.TopDirectoryOnly))
                        files.Add(f);
                }
                catch { }
            }
        }
        catch { }

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

            var talk = new Talk
            {
                Id5 = Marshal.GetDelegateForFunctionPointer<DsId5>(entry),
                Ui5 = Marshal.GetDelegateForFunctionPointer<DsUi5>(entry),
                Cap5 = Marshal.GetDelegateForFunctionPointer<DsCap5>(entry),
                Ev5 = Marshal.GetDelegateForFunctionPointer<DsEv5>(entry),
                Pend5 = Marshal.GetDelegateForFunctionPointer<DsPend5>(entry),
                Ptr5 = Marshal.GetDelegateForFunctionPointer<DsPtr5>(entry),

                Id6 = Marshal.GetDelegateForFunctionPointer<DsId>(entry),
                Ui6 = Marshal.GetDelegateForFunctionPointer<DsUi>(entry),
                Cap6 = Marshal.GetDelegateForFunctionPointer<DsCap>(entry),
                Ev6 = Marshal.GetDelegateForFunctionPointer<DsEv>(entry),
                Pend6 = Marshal.GetDelegateForFunctionPointer<DsPend>(entry),
                Ptr6 = Marshal.GetDelegateForFunctionPointer<DsPtr>(entry),
            };

            // Открываем аппарат. Форму вызова подбираем: сначала по
            // стандарту (пять частей), затем как у посредника (шесть).
            //
            // Отдельная тонкость: ответ драйвер пишет в ТУ ЖЕ запись,
            // которую получил вопросом. Держим их раздельно, иначе
            // драйвер затирает вопрос своим ответом на полпути
            ushort rc = 1;
            bool opened = false;

            foreach (bool shortForm in new[] { true, false })
            {
                talk.Short = shortForm;
                talk.Dest = Blank();

                var self = Blank();
                string form = shortForm ? "по стандарту" : "как у посредника";

                try { rc = talk.Id(ref app, DG_CONTROL, DAT_IDENTITY, MSG_OPENDS, ref self); }
                catch (Exception ex)
                {
                    Log.Add($"прямая съёмка: {rules}, {form} — сбой: {Short(ex)}");
                    continue;
                }

                if (rc != TWRC_SUCCESS)
                {
                    Log.Add($"прямая съёмка: {rules}, {form} — не открылся (ответ {rc})");
                    continue;
                }

                // Аппарат открыт: дальше все вопросы адресуем ему,
                // а не пустышке
                src = self;
                talk.Dest = self;
                opened = true;

                string name = FromStr32(self.ProductName);
                Log.Add($"прямая съёмка: {rules}, {form} — открыт аппарат «{name}»");
                break;
            }

            if (!opened) return files;

            dsOpen = true;

            Setup(talk, ref app, opt);

            IntPtr hwnd = Handle.Window;
            var ui = new TwUserInterface
            {
                ShowUI = (ushort)(opt.ShowUi ? 1 : 0),
                ModalUI = 0,
                hParent = hwnd,
            };

            rc = talk.Ui(ref app, DG_CONTROL, DAT_USERINTERFACE, MSG_ENABLEDS, ref ui);
            if (rc != TWRC_SUCCESS && rc != 2)
            {
                Log.Add($"прямая съёмка: {rules} — аппарат не начал работу (ответ {rc})");
                return files;
            }

            enabled = true;

            int made = 0;
            int cap = opt.Limit > 0 ? opt.Limit : 500;
            bool done = false;

            // Ждём сообщений от драйвера, но не бесконечно: если аппарат
            // замолчал совсем, лучше честно сказать об этом, чем
            // оставить программу висеть без ответа
            const uint QS_ALLINPUT = 0x04FF;
            const uint PM_REMOVE = 0x0001;
            const uint WAIT_TIMEOUT = 0x00000102;
            int silentFor = 0;

            while (!done)
            {
                // Ничего не пришло — ждём порцию времени
                if (!PeekMessage(out WinMsg m, IntPtr.Zero, 0, 0, PM_REMOVE))
                {
                    uint w = MsgWaitForMultipleObjects(0, null, false, 1000, QS_ALLINPUT);

                    if (w == WAIT_TIMEOUT)
                    {
                        silentFor++;

                        // Две минуты полной тишины: первый лист так и
                        // не пришёл. Дальше ждать бессмысленно
                        if (silentFor >= 120 && files.Count == 0)
                        {
                            Log.Add($"прямая съёмка: {rules} — аппарат не отозвался за две минуты");
                            break;
                        }

                        // Листы уже есть, а новых нет полминуты —
                        // считаем, что пачка закончилась
                        if (silentFor >= 30 && files.Count > 0) break;
                    }

                    continue;
                }

                silentFor = 0;

                IntPtr raw = Marshal.AllocHGlobal(Marshal.SizeOf<WinMsg>());
                Marshal.StructureToPtr(m, raw, false);

                var ev = new TwEvent { pEvent = raw, TWMessage = 0 };
                ushort erc = talk.Ev(ref app, DG_CONTROL, DAT_EVENT, MSG_PROCESSEVENT, ref ev);
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
                    ushort trc = talk.Ptr(ref app, DG_IMAGE, DAT_IMAGENATIVEXFER, MSG_GET, ref img);

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
                    talk.Pend(ref app, DG_CONTROL, DAT_PENDINGXFERS, MSG_ENDXFER, ref pend);

                    if (trc == TWRC_CANCEL) { done = true; break; }
                    if (made >= cap) break;
                }
                while (pend.Count != 0);

                var rest = new TwPendingXfers();
                talk.Pend(ref app, DG_CONTROL, DAT_PENDINGXFERS, MSG_RESET, ref rest);

                // Пачка из автоподатчика приходит несколькими порциями:
                // ждём дальше, пока аппарат не замолчит. При съёмке со
                // стекла лист один — на нём и заканчиваем
                if (!opt.Feeder) done = true;
            }

            Log.Add($"прямая съёмка: {rules} — листов снято {files.Count}");

            if (enabled)
            {
                var off = new TwUserInterface { ShowUI = 0, ModalUI = 0, hParent = hwnd };
                talk.Ui(ref app, DG_CONTROL, DAT_USERINTERFACE, MSG_DISABLEDS, ref off);
                enabled = false;
            }

            if (dsOpen)
            {
                var closing = src;
                talk.Id(ref app, DG_CONTROL, DAT_IDENTITY, MSG_CLOSEDS, ref closing);
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
    static void Setup(Talk call, ref TwIdentity app, Twain.Options opt)
    {
        One(call, ref app, ICAP_XFERMECH, TWTY_UINT16, TWSX_NATIVE);
        One(call, ref app, ICAP_UNITS, TWTY_UINT16, TWUN_INCHES);

        ushort pixel = opt.Color switch
        {
            "bw" => TWPT_BW,
            "gray" => TWPT_GRAY,
            _ => TWPT_RGB,
        };
        One(call, ref app, ICAP_PIXELTYPE, TWTY_UINT16, pixel);
        One(call, ref app, ICAP_BITDEPTH, TWTY_UINT16, opt.Color switch
        {
            "bw" => (ushort)1,
            "gray" => (ushort)8,
            _ => (ushort)24,
        });

        int dpi = Math.Max(75, Math.Min(1200, opt.Dpi));
        Raw(call, ref app, ICAP_XRESOLUTION, TWTY_FIX32, (uint)(ushort)dpi);
        Raw(call, ref app, ICAP_YRESOLUTION, TWTY_FIX32, (uint)(ushort)dpi);

        // Размер листа A4: без него аппарат снимает область нулевого
        // размера и не отдаёт страниц
        One(call, ref app, ICAP_SUPPORTEDSIZES, TWTY_UINT16, TWSS_A4);

        One(call, ref app, CAP_FEEDERENABLED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        One(call, ref app, CAP_AUTOFEED, TWTY_BOOL, (ushort)(opt.Feeder ? 1 : 0));
        if (opt.Feeder)
            One(call, ref app, CAP_DUPLEXENABLED, TWTY_BOOL, (ushort)(opt.Duplex ? 1 : 0));

        One(call, ref app, CAP_XFERCOUNT, TWTY_INT16,
            opt.Limit > 0 ? (ushort)opt.Limit : unchecked((ushort)-1));
    }

    static void One(Talk call, ref TwIdentity app, ushort cap, ushort type, ushort value)
        => Raw(call, ref app, cap, type, value);

    static void Raw(Talk call, ref TwIdentity app, ushort cap, ushort type, uint value)
    {
        IntPtr h = GlobalAlloc(GHND, (UIntPtr)8);
        if (h == IntPtr.Zero) return;

        IntPtr p = GlobalLock(h);
        if (p == IntPtr.Zero) { GlobalFree(h); return; }

        Marshal.WriteInt16(p, 0, (short)type);
        Marshal.WriteInt32(p, 4, (int)value);
        GlobalUnlock(h);

        var c = new TwCapability { Cap = cap, ConType = TWON_ONEVALUE, hContainer = h };
        try { call.Cap(ref app, DG_CONTROL, DAT_CAPABILITY, MSG_SET, ref c); }
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

    static string FromStr32(byte[] b)
    {
        if (b == null) return "";
        int n = Array.IndexOf(b, (byte)0);
        return System.Text.Encoding.Default.GetString(b, 0, n < 0 ? b.Length : n).Trim();
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
