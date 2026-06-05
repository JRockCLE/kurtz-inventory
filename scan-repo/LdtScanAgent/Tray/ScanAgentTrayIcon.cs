using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Windows.Forms;
using LdtScanAgent.Services;

namespace LdtScanAgent.Tray;

public class ScanAgentTrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ContextMenuStrip _menu;

    public ScanAgentTrayIcon()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown";

        _menu = new ContextMenuStrip();

        _menu.Items.Add(new ToolStripMenuItem($"LDT Scan Agent v{version}") { Enabled = false });
        _menu.Items.Add(new ToolStripMenuItem($"Listening on localhost:{HttpServer.Port}") { Enabled = false });
        _menu.Items.Add(new ToolStripSeparator());

        _menu.Items.Add(new ToolStripMenuItem("Open Test Page", null, OpenTestPage));
        _menu.Items.Add(new ToolStripMenuItem("Open Diagnostics", null, OpenDiagnostics));
        _menu.Items.Add(new ToolStripSeparator());

        _menu.Items.Add(new ToolStripMenuItem("Open Config Folder", null, OpenConfigFolder));
        _menu.Items.Add(new ToolStripMenuItem("Open Log File",      null, OpenLogFile));
        _menu.Items.Add(new ToolStripMenuItem("Open Log Folder",    null, OpenLogFolder));
        _menu.Items.Add(new ToolStripSeparator());

        _menu.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => Application.Exit()));

        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,  // TODO: replace with branded icon
            Text = $"LDT Scan Agent — listening on :{HttpServer.Port}",
            Visible = true,
            ContextMenuStrip = _menu,
        };
    }

    private void OpenConfigFolder(object? sender, EventArgs e)
    {
        var cfg = new ConfigService();
        var folder = Path.GetDirectoryName(cfg.ConfigPath);
        if (folder != null && Directory.Exists(folder))
            StartShell(folder);
    }

    private void OpenLogFile(object? sender, EventArgs e)
    {
        if (!File.Exists(Log.TodayFile))
        {
            MessageBox.Show("No log file yet for today.", "LDT Scan Agent");
            return;
        }
        StartShell(Log.TodayFile);
    }

    private void OpenLogFolder(object? sender, EventArgs e)
    {
        if (Directory.Exists(Log.LogDir)) StartShell(Log.LogDir);
    }

    private void OpenTestPage(object? sender, EventArgs e)
        => StartShell($"http://localhost:{HttpServer.Port}/version");

    private void OpenDiagnostics(object? sender, EventArgs e)
        => StartShell($"http://localhost:{HttpServer.Port}/diagnostics");

    private static void StartShell(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log.Error($"Could not open '{target}'", ex);
        }
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _menu.Dispose();
    }
}
