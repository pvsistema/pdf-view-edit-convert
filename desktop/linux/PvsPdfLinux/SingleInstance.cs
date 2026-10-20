using System.Net.Sockets;
using System.Text;

namespace PvsPdfLinux;

// Одна копия программы на пользователя. Повторный запуск (двойной щелчок
// по PDF при открытой программе) передаёт файлы уже открытому окну —
// документ откроется новой вкладкой
internal static class SingleInstance
{
    static FileStream? _lock;

    // true — мы первая копия
    public static bool Acquire()
    {
        try
        {
            Directory.CreateDirectory(Paths.DataDir);
            _lock = new FileStream(Paths.LockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            return true;
        }
        catch (IOException)
        {
            return false;
        }
    }

    public static bool SendToRunning(string[] files)
    {
        try
        {
            using var s = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            s.Connect(new UnixDomainSocketEndPoint(Paths.SocketPath));
            s.Send(Encoding.UTF8.GetBytes(string.Join("\n", files)));
            s.Shutdown(SocketShutdown.Send);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public static void Listen(Action<string[]> onFiles)
    {
        try { if (File.Exists(Paths.SocketPath)) File.Delete(Paths.SocketPath); } catch { }

        var server = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        server.Bind(new UnixDomainSocketEndPoint(Paths.SocketPath));
        try { File.SetUnixFileMode(Paths.SocketPath, UnixFileMode.UserRead | UnixFileMode.UserWrite); } catch { }
        server.Listen(4);

        _ = Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    using var client = await server.AcceptAsync();
                    using var ns = new NetworkStream(client);
                    using var reader = new StreamReader(ns, Encoding.UTF8);
                    string payload = await reader.ReadToEndAsync();
                    string[] paths = payload
                        .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                        .Select(p => p.Trim())
                        .Where(File.Exists)
                        .ToArray();
                    onFiles(paths);
                }
                catch
                {
                    await Task.Delay(300);
                }
            }
        });
    }
}
