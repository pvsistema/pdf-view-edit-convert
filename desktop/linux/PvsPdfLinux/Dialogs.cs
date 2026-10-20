using Photino.NET;

namespace PvsPdfLinux;

// Системные окна «Сохранить как», «Выбрать папку» и сообщения.
//
// Сначала пробуем zenity / kdialog: они подставляют имя файла и выглядят
// привычно для пользователя (Fly в Astra, GNOME, KDE). Если их нет —
// встроенное окно GTK из библиотеки окна программы
internal static class Dialogs
{
    public static PhotinoWindow? Window { get; set; }

    static string Documents()
    {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (string name in new[] { "Документы", "Documents" })
        {
            string d = Path.Combine(home, name);
            if (Directory.Exists(d)) return d;
        }
        try
        {
            var r = Shell.Run("xdg-user-dir", new[] { "DOCUMENTS" }, 3000);
            string d = r.Out.Trim();
            if (d.Length > 0 && Directory.Exists(d)) return d;
        }
        catch { }
        return home;
    }

    // Путь для сохранения или null, если человек передумал
    public static string? SaveFile(string fileName, string ext, string filterName)
    {
        string start = Path.Combine(Documents(), fileName);

        if (Shell.Exists("zenity"))
        {
            var r = Shell.Run("zenity", new[]
            {
                "--file-selection", "--save", "--confirm-overwrite",
                "--title=Сохранить как",
                "--filename=" + start,
                $"--file-filter={filterName} | *.{ext}",
                "--file-filter=Все файлы | *",
            }, int.MaxValue);
            return r.Code == 0 ? Fix(r.Out.Trim(), ext) : null;
        }

        if (Shell.Exists("kdialog"))
        {
            var r = Shell.Run("kdialog", new[]
            {
                "--title", "Сохранить как",
                "--getsavefilename", start, $"*.{ext}|{filterName}",
            }, int.MaxValue);
            string path = Fix(r.Out.Trim(), ext);
            if (r.Code != 0 || path.Length == 0) return null;
            if (File.Exists(path) && !Ask("Файл «" + Path.GetFileName(path) + "» уже есть. Заменить его?"))
                return null;
            return path;
        }

        var w = Window;
        if (w == null) return null;
        string? res = w.ShowSaveFile("Сохранить как — " + fileName, Documents(),
            new[] { (filterName, new[] { "*." + ext }), ("Все файлы", new[] { "*" }) });
        if (string.IsNullOrWhiteSpace(res)) return null;

        // Встроенное окно не подставляет имя: если человек выбрал только
        // папку или не написал расширение — достраиваем сами
        if (Directory.Exists(res)) res = Path.Combine(res, fileName);
        return Fix(res, ext);
    }

    static string Fix(string path, string ext)
    {
        if (path.Length == 0) return path;
        return Path.HasExtension(path) ? path : path + "." + ext;
    }

    public static string? PickFolder(string title)
    {
        if (Shell.Exists("zenity"))
        {
            var r = Shell.Run("zenity", new[]
            {
                "--file-selection", "--directory", "--title=" + title,
                "--filename=" + Documents() + "/",
            }, int.MaxValue);
            return r.Code == 0 && r.Out.Trim().Length > 0 ? r.Out.Trim() : null;
        }

        if (Shell.Exists("kdialog"))
        {
            var r = Shell.Run("kdialog", new[] { "--title", title, "--getexistingdirectory", Documents() }, int.MaxValue);
            return r.Code == 0 && r.Out.Trim().Length > 0 ? r.Out.Trim() : null;
        }

        var res = Window?.ShowOpenFolder(title, Documents(), false);
        return res is { Length: > 0 } && !string.IsNullOrWhiteSpace(res[0]) ? res[0] : null;
    }

    public static void Warn(string text)
    {
        try
        {
            if (Shell.Exists("zenity"))
            {
                Shell.Run("zenity", new[] { "--warning", "--no-wrap", "--title=ПВ-Система PDF", "--text=" + Escape(text) }, int.MaxValue);
                return;
            }
            if (Shell.Exists("kdialog"))
            {
                Shell.Run("kdialog", new[] { "--title", "ПВ-Система PDF", "--sorry", text }, int.MaxValue);
                return;
            }
            Window?.ShowMessage("ПВ-Система PDF", text, PhotinoDialogButtons.Ok, PhotinoDialogIcon.Warning);
        }
        catch { }
    }

    public static bool Ask(string text)
    {
        try
        {
            if (Shell.Exists("zenity"))
            {
                var r = Shell.Run("zenity", new[]
                {
                    "--question", "--no-wrap", "--title=ПВ-Система PDF",
                    "--ok-label=Да", "--cancel-label=Нет", "--text=" + Escape(text),
                }, int.MaxValue);
                return r.Code == 0;
            }
            if (Shell.Exists("kdialog"))
            {
                var r = Shell.Run("kdialog", new[] { "--title", "ПВ-Система PDF", "--warningyesno", text }, int.MaxValue);
                return r.Code == 0;
            }
            var w = Window;
            if (w == null) return true;
            return w.ShowMessage("ПВ-Система PDF", text, PhotinoDialogButtons.YesNo, PhotinoDialogIcon.Question)
                   == PhotinoDialogResult.Yes;
        }
        catch { return true; }
    }

    // zenity понимает разметку Pango — экранируем спецсимволы
    static string Escape(string s) =>
        s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
}
