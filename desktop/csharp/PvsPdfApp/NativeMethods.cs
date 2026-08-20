using System.Runtime.InteropServices;

namespace PvsPdfApp;

internal static class NativeMethods
{
    // Ссылка на существующий файл вместо его копии. Работает в пределах
    // одного диска: документ на сотни мегабайт становится доступен мгновенно,
    // место на диске при этом не занимается
    [DllImport("kernel32.dll", EntryPoint = "CreateHardLinkW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateHardLink(
        string lpFileName,
        string lpExistingFileName,
        IntPtr lpSecurityAttributes);
}