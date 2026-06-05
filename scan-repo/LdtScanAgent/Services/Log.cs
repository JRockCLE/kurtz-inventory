namespace LdtScanAgent.Services;

/// <summary>
/// Thread-safe file logger. Writes daily-rotated files to
/// %APPDATA%\LDT\scan-agent\logs\agent-YYYY-MM-DD.log.
///
/// Designed for diagnostics — every request, every scan step, every error.
/// Without this, every future bug is a guessing game.
/// </summary>
public static class Log
{
    private static readonly object _gate = new();
    private static readonly string _logDir;
    private static volatile string _lastError = "";

    static Log()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        _logDir = Path.Combine(appData, "LDT", "scan-agent", "logs");
        try { Directory.CreateDirectory(_logDir); } catch { /* logger must never throw */ }
    }

    public static string LogDir => _logDir;
    public static string LastError => _lastError;
    public static string TodayFile => Path.Combine(_logDir, $"agent-{DateTime.Now:yyyy-MM-dd}.log");

    public static void Info(string msg)  => Write("INFO ", msg);
    public static void Warn(string msg)  => Write("WARN ", msg);

    public static void Error(string msg, Exception? ex = null)
    {
        var full = ex == null ? msg : $"{msg} | {ex.GetType().Name}: {ex.Message}";
        _lastError = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {full}";
        Write("ERROR", full);
        if (ex?.StackTrace != null) Write("ERROR", ex.StackTrace);
    }

    /// <summary>Return up to N most-recent log lines from today's file.</summary>
    public static string[] Tail(int lines = 100)
    {
        try
        {
            if (!File.Exists(TodayFile)) return Array.Empty<string>();
            using var fs = new FileStream(TodayFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs);
            var all = sr.ReadToEnd().Split('\n');
            return all.Skip(Math.Max(0, all.Length - lines))
                      .Select(l => l.TrimEnd('\r'))
                      .Where(l => l.Length > 0)
                      .ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    private static void Write(string level, string msg)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {msg}";
        try
        {
            lock (_gate) File.AppendAllText(TodayFile, line + Environment.NewLine);
        }
        catch { /* never throw from logger */ }
    }
}
