using System.Text.Json;

namespace PvsPdfApp;

// Настройки программы: хранятся в файле settings.json рядом с программой
public static class Settings
{
    class Data
    {
        public string? Printer { get; set; }
        public bool RememberPrinter { get; set; } = true;
    }

    static readonly string FilePath = Path.Combine(Program.InstallDir, "settings.json");
    static Data _data = Load();

    static Data Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Data>(File.ReadAllText(FilePath)) ?? new Data();
        }
        catch { }
        return new Data();
    }

    static void Save()
    {
        try
        {
            Directory.CreateDirectory(Program.InstallDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(_data));
        }
        catch { }
    }

    // Принтер, выбранный в прошлый раз
    public static string? Printer
    {
        get => _data.Printer;
        set { _data.Printer = value; Save(); }
    }

    // Печатать сразу на запомненный принтер, не спрашивая каждый раз
    public static bool RememberPrinter
    {
        get => _data.RememberPrinter;
        set { _data.RememberPrinter = value; Save(); }
    }

    public static void Reset()
    {
        _data = new Data();
        Save();
    }
}
