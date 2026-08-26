using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace PvsPdfApp;

// Лицензия живёт здесь, а не в браузере. Программа принимает ответ сервера
// только с верной подписью, поэтому правкой памяти браузера полную версию
// включить нельзя: подписать поддельный ответ без ключа сервера невозможно
internal static class License
{
    // Публичный ключ сервера. Подделать подпись, зная только его, нельзя —
    // для этого нужен приватный ключ, который сервер никому не отдаёт
    const string ServerKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOvQCM/7mejxR2FVAXojqZiHeMdNd" +
        "Gww7OvpKRFXiIhWDwLskOgyUxe+cq6asXPGsQ7hU5RaOfP7NKkDmm2dYeQ==";

    // Ответ старше этого срока считаем просроченным: так подсунуть
    // сохранённый когда-то правильный ответ не получится
    static readonly TimeSpan MaxAge = TimeSpan.FromDays(40);

    sealed class Stored
    {
        public string Payload { get; set; } = "";   // подписанные данные, как есть
        public string Sig { get; set; } = "";       // подпись сервера
        public string Key { get; set; } = "";
        public string Org { get; set; } = "";
        public string Until { get; set; } = "";
        public long SavedAt { get; set; }
    }

    static readonly string FilePath = Path.Combine(Program.InstallDir, "license.dat");
    static Stored? _data = Load();

    // Отпечаток компьютера. Считается из серийного номера установки Windows,
    // поэтому не меняется от перезагрузок, но отличается на другой машине
    public static string MachineId()
    {
        string seed = "";
        try
        {
            using var k = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            seed = k?.GetValue("ProductId")?.ToString() ?? "";
            if (string.IsNullOrEmpty(seed))
                seed = k?.GetValue("InstallDate")?.ToString() ?? "";
        }
        catch { }

        if (string.IsNullOrEmpty(seed)) seed = Environment.MachineName;

        // Сам серийный номер наружу не уходит — только его отпечаток
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes("pvspdf:" + seed));
        return Convert.ToHexString(hash)[..32].ToLowerInvariant();
    }

    public static string MachineName()
    {
        try { return Environment.MachineName; } catch { return ""; }
    }

    // Полная версия включена. Здесь и только здесь принимается решение:
    // подпись сходится, машина та самая, срок не вышел
    public static bool IsFull()
    {
        var d = _data;
        if (d == null) return false;
        if (!Verify(d.Payload, d.Sig)) return false;

        try
        {
            using var doc = JsonDocument.Parse(d.Payload);
            var root = doc.RootElement;

            if (!root.GetProperty("valid").GetBoolean()) return false;

            // Ответ, выданный для другого компьютера, не принимаем
            string machine = root.TryGetProperty("machine", out var m) ? (m.GetString() ?? "") : "";
            if (!string.IsNullOrEmpty(machine) && machine != MachineId()) return false;

            // Ответ не должен быть слишком старым
            if (root.TryGetProperty("issued", out var iss) &&
                DateTime.TryParse(iss.GetString(), out var issued))
            {
                if (DateTime.UtcNow - issued.ToUniversalTime() > MaxAge) return false;
            }

            // Срок действия лицензии
            string until = root.TryGetProperty("until", out var u) ? (u.GetString() ?? "") : "";
            if (!string.IsNullOrEmpty(until) && DateTime.TryParse(until, out var end))
            {
                if (end.Date < DateTime.UtcNow.Date) return false;
            }

            return true;
        }
        catch { return false; }
    }

    public static string Org => _data?.Org ?? "";
    public static string Key => _data?.Key ?? "";
    public static string Until => _data?.Until ?? "";

    // Сохраняем ответ сервера, но только если подпись верна
    public static bool Save(string payloadJson, string sig)
    {
        if (!Verify(payloadJson, sig)) return false;

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;

            if (!root.GetProperty("valid").GetBoolean()) return false;

            string machine = root.TryGetProperty("machine", out var m) ? (m.GetString() ?? "") : "";
            if (!string.IsNullOrEmpty(machine) && machine != MachineId()) return false;

            _data = new Stored
            {
                Payload = payloadJson,
                Sig = sig,
                Key = root.TryGetProperty("key", out var k) ? (k.GetString() ?? "") : "",
                Org = root.TryGetProperty("org", out var o) ? (o.GetString() ?? "") : "",
                Until = root.TryGetProperty("until", out var u) ? (u.GetString() ?? "") : "",
                SavedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            };
            Write();
            return true;
        }
        catch { return false; }
    }

    public static void Clear()
    {
        _data = null;
        try { if (File.Exists(FilePath)) File.Delete(FilePath); } catch { }
    }

    // Проверка подписи публичным ключом сервера
    static bool Verify(string payloadJson, string sig)
    {
        if (string.IsNullOrEmpty(payloadJson) || string.IsNullOrEmpty(sig)) return false;
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(ServerKey), out _);

            byte[] signature = Convert.FromBase64String(sig);
            byte[] message = Encoding.UTF8.GetBytes(payloadJson);

            // Подпись приходит в стандартном виде DER
            return ecdsa.VerifyData(message, signature, HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence);
        }
        catch { return false; }
    }

    static Stored? Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return null;
            byte[] raw = Protect(File.ReadAllBytes(FilePath), false);
            return JsonSerializer.Deserialize<Stored>(Encoding.UTF8.GetString(raw));
        }
        catch { return null; }
    }

    static void Write()
    {
        try
        {
            Directory.CreateDirectory(Program.InstallDir);
            byte[] raw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(_data));
            File.WriteAllBytes(FilePath, Protect(raw, true));
        }
        catch { }
    }

    // Файл лицензии шифруется средствами Windows и привязывается к машине:
    // перенести его на другой компьютер бесполезно
    static byte[] Protect(byte[] data, bool encrypt)
    {
        try
        {
            return encrypt
                ? ProtectedData.Protect(data, null, DataProtectionScope.LocalMachine)
                : ProtectedData.Unprotect(data, null, DataProtectionScope.LocalMachine);
        }
        catch
        {
            return data;
        }
    }
}
