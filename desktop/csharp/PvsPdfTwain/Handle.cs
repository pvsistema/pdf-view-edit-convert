using System.Windows.Forms;

namespace PvsPdfTwain;

// Драйверу сканера нужно окно, которому он шлёт сообщения о готовых
// листах. Окно скрытое: пользователь его не видит, но без него
// большинство драйверов работать отказываются
internal static class Handle
{
    static Form? _form;

    public static IntPtr Window
    {
        get
        {
            if (_form == null)
            {
                _form = new Form
                {
                    ShowInTaskbar = false,
                    FormBorderStyle = FormBorderStyle.FixedToolWindow,
                    StartPosition = FormStartPosition.Manual,
                    Location = new System.Drawing.Point(-6000, -6000),
                    Size = new System.Drawing.Size(1, 1),
                    Opacity = 0,
                };
                _ = _form.Handle;   // окно создаётся именно здесь
            }
            return _form.Handle;
        }
    }

    // Окно выбора сканера драйвер рисует ПОВЕРХ окна-владельца. Скрытое
    // окно висит за краем экрана — вместе с ним туда уедет и окно выбора,
    // и человек его не увидит. Поэтому на время выбора выводим владельца
    // в центр экрана и делаем видимым
    public static void Show()
    {
        var f = _form;
        if (f == null) { _ = Window; f = _form; }
        if (f == null) return;

        try
        {
            f.Opacity = 1;
            f.Size = new System.Drawing.Size(1, 1);
            f.StartPosition = FormStartPosition.CenterScreen;

            var screen = Screen.PrimaryScreen?.WorkingArea
                         ?? new System.Drawing.Rectangle(0, 0, 1024, 768);

            f.Location = new System.Drawing.Point(
                screen.X + screen.Width / 2,
                screen.Y + screen.Height / 2);

            f.TopMost = true;
            f.Show();
            f.Activate();

            // Окну нужно дать прожевать накопившиеся сообщения, иначе
            // оно останется недорисованным и драйвер покажет список
            // поверх пустоты. Так же поступает рабочая программа ABBYY
            Application.DoEvents();
        }
        catch { }
    }

    public static void Hide()
    {
        try
        {
            if (_form == null) return;
            _form.TopMost = false;
            _form.Opacity = 0;
            _form.Hide();
        }
        catch { }
    }

    public static void Close()
    {
        try { _form?.Dispose(); } catch { }
        _form = null;
    }
}
