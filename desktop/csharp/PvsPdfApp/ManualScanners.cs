using System.Text.Json;

namespace PvsPdfApp;

// Сканеры, добавленные человеком вручную.
//
// Зачем. Часть аппаратов не отзывается ни на один общий опрос: драйверы
// некоторых сетевых МФУ (Kyocera, Ricoh, Sharp) объявляют устройство
// только своей программе и молчат в ответ остальным. Такой сканер
// исправен и прекрасно работает — его просто не видно в списке.
//
// Здесь человек называет аппарат сам. Программа запоминает имя и
// показывает его наравне с найденными, а при съёмке обращается
// к драйверу напрямую по этому имени.
internal static class ManualScanners
{
    public sealed class Item
    {
        public string Name { get; set; } = "";

        // Через что снимать: драйвер производителя или службу Windows
        public bool Wia { get; set; }

        // Есть ли автоподатчик. Спросить у молчащего аппарата нельзя,
        // поэтому отмечает человек
        public bool Feeder { get; set; }
        public bool Duplex { get; set; }
    }

    static string File_ => Path.Combine(Program.InstallDir, "data", "scanners.json");

    // Список добавленных вручную. Ошибки чтения не страшны: пустой
    // список просто означает «ничего не добавляли»
    public static List<Item> All()
    {
        try
        {
            if (!File.Exists(File_)) return new List<Item>();

            string raw = File.ReadAllText(File_);
            var list = JsonSerializer.Deserialize<List<Item>>(raw);

            return list?.Where(x => !string.IsNullOrWhiteSpace(x.Name)).ToList()
                   ?? new List<Item>();
        }
        catch { return new List<Item>(); }
    }

    // Добавить аппарат. Повторное имя не создаёт двойника, а обновляет
    // прежнюю запись — человек мог поправить настройки
    public static bool Add(Item item)
    {
        if (string.IsNullOrWhiteSpace(item.Name)) return false;

        try
        {
            var list = All();
            list.RemoveAll(x => string.Equals(x.Name, item.Name, StringComparison.OrdinalIgnoreCase));
            list.Add(item);
            return Save(list);
        }
        catch { return false; }
    }

    public static bool Remove(string name)
    {
        try
        {
            var list = All();
            int was = list.Count;
            list.RemoveAll(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));

            if (list.Count == was) return false;
            return Save(list);
        }
        catch { return false; }
    }

    static bool Save(List<Item> list)
    {
        try
        {
            string dir = Path.GetDirectoryName(File_) ?? "";
            if (dir.Length > 0) Directory.CreateDirectory(dir);

            File.WriteAllText(File_,
                JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true }));

            return true;
        }
        catch { return false; }
    }
}
