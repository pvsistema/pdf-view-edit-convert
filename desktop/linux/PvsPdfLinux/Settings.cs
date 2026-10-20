using System.Text.Json;

namespace PvsPdfLinux;

public static class Settings
{
    class Data
    {
        public string? Printer { get; set; }
    }

    static readonly string FilePath = Path.Combine(Paths.DataDir, "settings.json");
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
            Directory.CreateDirectory(Paths.DataDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(_data));
        }
        catch { }
    }

    public static string? Printer
    {
        get => _data.Printer;
        set { _data.Printer = value; Save(); }
    }
}
