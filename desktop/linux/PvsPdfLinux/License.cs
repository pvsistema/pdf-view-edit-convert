using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PvsPdfLinux;

// Лицензия — та же схема, что в Windows-версии: программа принимает только
// ответ сервера с верной подписью, решение «полная версия или нет» принимает
// она сама, а не страница
internal static class License
{
    // Тот же публичный ключ сервера, что и в Windows-версии
    const string ServerKey =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOvQCM/7mejxR2FVAXojqZiHeMdNd" +
        "Gww7OvpKRFXiIhWDwLskOgyUxe+cq6asXPGsQ7hU5RaOfP7NKkDmm2dYeQ==";

    static readonly TimeSpan MaxAge = TimeSpan.FromDays(40);

    sealed class Stored
    {
        public string Payload { get; set; } = "";
        public string Sig { get; set; } = "";
        public string Key { get; set; } = "";
        public string Org { get; set; } = "";
        public string Until { get; set; } = "";
        public long SavedAt { get; set; }
    }

    static readonly string FilePath = Path.Combine(Paths.DataDir, "license.dat");
    static Stored? _data = Load();

    // Отпечаток компьютера. В Linux у каждой установки системы есть
    // постоянный номер /etc/machine-id: он не меняется от перезагрузок,
    // но свой на каждой машине. Наружу уходит только его отпечаток
    public static string MachineId()
    {
        string seed = ReadFirst("/etc/machine-id", "/var/lib/dbus/machine-id");
        if (string.IsNullOrEmpty(seed)) seed = MachineName();

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes("pvspdf:linux:" + seed));
        return Convert.ToHexString(hash)[..32].ToLowerInvariant();
    }

    public static string MachineName()
    {
        try { return Environment.MachineName; } catch { return ""; }
    }

    static string ReadFirst(params string[] files)
    {
        foreach (string f in files)
        {
            try
            {
                if (File.Exists(f))
                {
                    string v = File.ReadAllText(f).Trim();
                    if (v.Length > 0) return v;
                }
            }
            catch { }
        }
        return "";
    }

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

            string machine = root.TryGetProperty("machine", out var m) ? (m.GetString() ?? "") : "";
            if (!string.IsNullOrEmpty(machine) && machine != MachineId()) return false;

            if (root.TryGetProperty("issued", out var iss) &&
                DateTime.TryParse(iss.GetString(), out var issued))
            {
                if (DateTime.UtcNow - issued.ToUniversalTime() > MaxAge) return false;
            }

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

    static bool Verify(string payloadJson, string sig)
    {
        if (string.IsNullOrEmpty(payloadJson) || string.IsNullOrEmpty(sig)) return false;
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(ServerKey), out _);
            return ecdsa.VerifyData(
                Encoding.UTF8.GetBytes(payloadJson),
                Convert.FromBase64String(sig),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence);
        }
        catch { return false; }
    }

    static Stored? Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return null;
            byte[] raw = Decrypt(File.ReadAllBytes(FilePath));
            return JsonSerializer.Deserialize<Stored>(Encoding.UTF8.GetString(raw));
        }
        catch { return null; }
    }

    static void Write()
    {
        try
        {
            Directory.CreateDirectory(Paths.DataDir);
            byte[] raw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(_data));
            File.WriteAllBytes(FilePath, Encrypt(raw));
            try { File.SetUnixFileMode(FilePath, UnixFileMode.UserRead | UnixFileMode.UserWrite); } catch { }
        }
        catch { }
    }

    // Файл шифруется ключом, выведенным из номера машины: скопированный
    // на другой компьютер, он не расшифруется. Даже без шифра подделать
    // лицензию нельзя — её держит подпись сервера
    static byte[] FileKey() =>
        SHA256.HashData(Encoding.UTF8.GetBytes("pvspdf-license-file:" + MachineId()));

    static byte[] Encrypt(byte[] plain)
    {
        byte[] nonce = RandomNumberGenerator.GetBytes(12);
        byte[] cipher = new byte[plain.Length];
        byte[] tag = new byte[16];
        using var aes = new AesGcm(FileKey(), 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return [.. nonce, .. tag, .. cipher];
    }

    static byte[] Decrypt(byte[] data)
    {
        byte[] nonce = data[..12];
        byte[] tag = data[12..28];
        byte[] cipher = data[28..];
        byte[] plain = new byte[cipher.Length];
        using var aes = new AesGcm(FileKey(), 16);
        aes.Decrypt(nonce, cipher, tag, plain);
        return plain;
    }
}
