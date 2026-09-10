using System.Runtime.InteropServices;

namespace PvsPdfTwain;

// Прямой разговор с драйверами сканеров, минуя посредника Windows.
//
// Зачем. Обычно список сканеров спрашивают у посредника (TWAINDSM.dll):
// он сам обходит папки драйверов и опрашивает каждый. Но на части
// компьютеров посредник до некоторых драйверов не доходит и молча их
// пропускает — ровно наш случай с Kyocera: папка KMTWAIN на месте,
// файлы драйвера на месте, а в списке его нет.
//
// Здесь мы обходим папки сами и открываем каждый файл драйвера
// напрямую, как это делают программы вроде FineReader. Важная тонкость:
// перед загрузкой мы добавляем папку драйвера в список поиска, иначе
// он не находит свои вспомогательные файлы и молча не запускается —
// это и есть самая частая причина «драйвер есть, а сканера нет».
internal static class DriverDirect
{
    // Пошаговый рассказ о последнем поиске — идёт прямо в отчёт
    public static readonly List<string> Log = new();

    public sealed class Device
    {
        public string Name = "";
        public string File = "";   // какой файл драйвера его отдал
    }

    const uint DG_CONTROL = 0x0001;
    const uint DG_IMAGE = 0x0002;
    const ushort DAT_IDENTITY = 0x0003;
    const ushort DAT_PARENT = 0x0004;
    const ushort MSG_OPENDS = 0x0401;
    const ushort MSG_CLOSEDS = 0x0402;
    const ushort MSG_GET = 0x0001;
    const ushort TWRC_SUCCESS = 0;

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

    // Точка входа драйвера — та же, что у посредника
    delegate ushort DsEntry(
        ref TwIdentity origin, IntPtr zero, uint dg, ushort dat, ushort msg, ref TwIdentity data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);

    [DllImport("kernel32.dll")]
    static extern bool FreeLibrary(IntPtr module);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool SetDllDirectory(string? path);

    // Просим Windows искать спутники драйвера рядом с ним самим
    const uint WITH_ALTERED_PATH = 0x00000008;
    const uint SEARCH_DLL_DIR = 0x00000100;
    const uint SEARCH_DEFAULT_DIRS = 0x00001000;

    // Все сканеры, которых удалось расспросить напрямую
    public static List<Device> List()
    {
        var found = new List<Device>();
        Log.Clear();

        foreach (string file in DriverFiles())
        {
            try
            {
                foreach (var dev in AskDriver(file))
                {
                    if (found.Any(d => string.Equals(d.Name, dev.Name, StringComparison.OrdinalIgnoreCase)))
                        continue;

                    found.Add(dev);
                }
            }
            catch (Exception ex) { Log.Add("   сбой: " + Short(ex)); }
        }

        Log.Add("итого сканеров: " + found.Count);
        return found;
    }

    // Файлы драйверов в папках Windows. Берём папку своей разрядности:
    // 32-разрядный помощник читает twain_32, 64-разрядный — twain_64
    static List<string> DriverFiles()
    {
        var files = new List<string>();

        try
        {
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string root = Path.Combine(win, Environment.Is64BitProcess ? "twain_64" : "twain_32");

            if (!Directory.Exists(root))
            {
                Log.Add("папки драйверов нет: " + root);
                return files;
            }

            foreach (string dir in Directory.GetDirectories(root))
            {
                try
                {
                    // Файл драйвера — с расширением .ds. Их в папке
                    // может быть несколько, спрашиваем каждый
                    foreach (string f in Directory.GetFiles(dir, "*.ds", SearchOption.TopDirectoryOnly))
                        files.Add(f);
                }
                catch { }
            }

            Log.Add("файлов драйверов найдено: " + files.Count);
        }
        catch (Exception ex) { Log.Add("папки не прочитать: " + Short(ex)); }

        return files;
    }

    // Спрашиваем один файл драйвера: какие аппараты он знает
    static List<Device> AskDriver(string file)
    {
        var found = new List<Device>();
        string title = Path.GetFileName(file);
        string dir = Path.GetDirectoryName(file) ?? "";

        IntPtr module = IntPtr.Zero;

        // Ключевая тонкость: драйвер ищет свои вспомогательные файлы
        // рядом с собой. Без этой подсказки он молча не загружается
        SetDllDirectory(dir);

        try
        {
            module = LoadLibraryEx(file, IntPtr.Zero,
                WITH_ALTERED_PATH | SEARCH_DLL_DIR | SEARCH_DEFAULT_DIRS);

            if (module == IntPtr.Zero)
            {
                Log.Add($"{title}: не загружается (код {Marshal.GetLastWin32Error()})");
                return found;
            }

            IntPtr entry = GetProcAddress(module, "DS_Entry");
            if (entry == IntPtr.Zero)
            {
                Log.Add($"{title}: нет точки входа DS_Entry");
                return found;
            }

            var call = Marshal.GetDelegateForFunctionPointer<DsEntry>(entry);

            // Спрашиваем и по новым правилам, и по старым: драйверы
            // старше 2015 года часто понимают только старые
            foreach (bool oldRules in new[] { false, true })
            {
                var app = MakeAppId(oldRules);
                var src = new TwIdentity();

                ushort rc;
                try { rc = call(ref app, IntPtr.Zero, DG_CONTROL, DAT_IDENTITY, MSG_GET, ref src); }
                catch (Exception ex)
                {
                    Log.Add($"{title}: сбой при опросе — " + Short(ex));
                    break;
                }

                if (rc != TWRC_SUCCESS)
                {
                    Log.Add($"{title}: {(oldRules ? "правила старые" : "правила новые")} — ответ {rc}");
                    continue;
                }

                string name = FromStr32(src.ProductName);
                if (string.IsNullOrWhiteSpace(name))
                {
                    Log.Add($"{title}: аппарат без названия");
                    continue;
                }

                Log.Add($"{title}: {name}");
                if (!found.Any(d => string.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase)))
                    found.Add(new Device { Name = name, File = file });

                break;   // аппарат назвался, второй раз спрашивать незачем
            }
        }
        finally
        {
            if (module != IntPtr.Zero) FreeLibrary(module);
            SetDllDirectory(null);
        }

        return found;
    }

    static TwIdentity MakeAppId(bool oldRules) => new()
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
