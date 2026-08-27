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

    public static void Close()
    {
        try { _form?.Dispose(); } catch { }
        _form = null;
    }
}
