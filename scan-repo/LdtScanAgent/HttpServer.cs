using System.Diagnostics;
using System.Reflection;
using LdtScanAgent.Models;
using LdtScanAgent.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LdtScanAgent;

public static class HttpServer
{
    public const int Port = 7878;
    private static WebApplication? _app;
    private static readonly DateTime _startedAt = DateTime.UtcNow;

    public static async Task RunAsync(string[] args, StaScannerExecutor executor)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Localhost-only — never network-reachable
        builder.WebHost.ConfigureKestrel(opts => opts.ListenLocalhost(Port));

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(p =>
                p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
        });

        builder.Services.AddSingleton<ConfigService>();
        builder.Services.AddSingleton<ScannerService>();
        builder.Services.AddSingleton(executor);

        builder.Logging.SetMinimumLevel(LogLevel.Warning);

        _app = builder.Build();
        _app.UseCors();

        // Per-request access log → file
        _app.Use(async (ctx, next) =>
        {
            var sw = Stopwatch.StartNew();
            try { await next(); }
            finally
            {
                sw.Stop();
                Log.Info($"{ctx.Request.Method,-4} {ctx.Request.Path}{ctx.Request.QueryString} → {ctx.Response.StatusCode} in {sw.ElapsedMilliseconds}ms");
            }
        });

        // ────────────────────────────────────────────────────────────
        //  ENDPOINTS
        // ────────────────────────────────────────────────────────────

        _app.MapGet("/version", () => Results.Json(new
        {
            name     = "LDT Scan Agent",
            version  = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown",
            hostname = Environment.MachineName,
        }));

        _app.MapGet("/diagnostics", (StaScannerExecutor exec) => Results.Json(new
        {
            version       = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown",
            hostname      = Environment.MachineName,
            uptimeSeconds = (int)(DateTime.UtcNow - _startedAt).TotalSeconds,
            busy          = exec.IsBusy,
            lastError     = Log.LastError,
            logDir        = Log.LogDir,
            logFile       = Log.TodayFile,
            recent        = Log.Tail(100),
        }));

        _app.MapGet("/scanners", async (ScannerService scanners, StaScannerExecutor exec, HttpContext ctx) =>
        {
            try
            {
                var list = await exec.RunAsync(
                    () => scanners.EnumerateScanners(),
                    acquireTimeout: TimeSpan.FromSeconds(2),
                    ct: ctx.RequestAborted);
                return Results.Json(new { scanners = list });
            }
            catch (ScannerBusyException)
            {
                return Results.Json(new { error = "scanner_busy", message = "Scanner is in use; try again in a moment." }, statusCode: 409);
            }
            catch (OperationCanceledException)
            {
                return Results.Json(new { error = "cancelled" }, statusCode: 499);
            }
            catch (Exception ex)
            {
                Log.Error("/scanners failed", ex);
                return Results.Problem(title: "Failed to enumerate scanners", detail: ex.Message, statusCode: 500);
            }
        });

        // Property-dump endpoint for debugging finicky drivers. Pass the scanner id
        // either via ?id=... or the saved default. Returns every device-level and
        // item-level WIA property the driver exposes.
        _app.MapGet("/scanner-debug", async (HttpContext ctx, ScannerService scanners, ConfigService cfg, StaScannerExecutor exec) =>
        {
            try
            {
                var id = ctx.Request.Query["id"].ToString();
                if (string.IsNullOrWhiteSpace(id))
                    id = cfg.Load().DefaultScanner?.Id ?? "";
                if (string.IsNullOrWhiteSpace(id))
                    return Results.BadRequest(new { error = "no_scanner_id" });

                var dump = await exec.RunAsync(
                    () => scanners.DebugDump(id),
                    acquireTimeout: TimeSpan.FromSeconds(2),
                    ct: ctx.RequestAborted);
                return Results.Json(dump);
            }
            catch (ScannerNotFoundException ex)
            {
                return Results.Json(new { error = "scanner_not_found", saved = ex.SavedScannerName }, statusCode: 404);
            }
            catch (ScannerBusyException)
            {
                return Results.Json(new { error = "scanner_busy" }, statusCode: 409);
            }
            catch (Exception ex)
            {
                Log.Error("/scanner-debug failed", ex);
                return Results.Problem(detail: ex.Message, statusCode: 500);
            }
        });

        _app.MapGet("/config", (ConfigService cfg) => Results.Json(cfg.Load()));

        _app.MapPost("/config", async (HttpContext ctx, ConfigService cfg) =>
        {
            try
            {
                var newCfg = await ctx.Request.ReadFromJsonAsync<AgentConfig>();
                if (newCfg is null) return Results.BadRequest(new { error = "invalid_body" });

                newCfg.Configured = true;
                newCfg.ConfiguredAt = DateTime.UtcNow;
                cfg.Save(newCfg);
                return Results.Json(newCfg);
            }
            catch (Exception ex)
            {
                Log.Error("/config save failed", ex);
                return Results.Problem(title: "Failed to save config", detail: ex.Message, statusCode: 500);
            }
        });

        _app.MapPost("/scan", async (HttpContext ctx, ScannerService scanners, ConfigService cfg, StaScannerExecutor exec) =>
        {
            try
            {
                ScanRequest? req = null;
                if (ctx.Request.ContentLength > 0)
                    req = await ctx.Request.ReadFromJsonAsync<ScanRequest>();

                var config = cfg.Load();
                req ??= new ScanRequest();
                req.ScannerId ??= config.DefaultScanner?.Id;
                req.Source    ??= config.DefaultSource    ?? "Flatbed";
                req.Dpi       ??= config.DefaultDpi       ?? 300;
                req.ColorMode ??= config.DefaultColorMode ?? "Color";

                if (string.IsNullOrWhiteSpace(req.ScannerId))
                {
                    return Results.BadRequest(new
                    {
                        error = "no_scanner_configured",
                        message = "No scanner configured. Run setup first.",
                    });
                }

                // Short lock-acquire timeout: if scanner is already running, fail fast
                // so the UI can show "busy" instead of stacking up requests.
                var result = await exec.RunAsync(
                    ct => scanners.Scan(req, ct),
                    acquireTimeout: TimeSpan.FromMilliseconds(250),
                    ct: ctx.RequestAborted);
                return Results.Json(result);
            }
            catch (ScannerBusyException)
            {
                return Results.Json(new { error = "scanner_busy", message = "Another scan is already in progress." }, statusCode: 409);
            }
            catch (ScannerNotFoundException ex)
            {
                return Results.Json(new
                {
                    error        = "scanner_not_found",
                    savedScanner = ex.SavedScannerName,
                    message      = ex.Message,
                }, statusCode: 404);
            }
            catch (OperationCanceledException)
            {
                Log.Warn("/scan cancelled by client");
                return Results.Json(new { error = "cancelled" }, statusCode: 499);
            }
            catch (Exception ex)
            {
                Log.Error("/scan failed", ex);
                return Results.Problem(title: "Scan failed", detail: ex.Message, statusCode: 500);
            }
        });

        Log.Info($"HTTP server listening on http://localhost:{Port}");
        try
        {
            await _app.RunAsync();
        }
        catch (Exception ex)
        {
            Log.Error("HTTP server crashed", ex);
            throw;
        }
    }

    /// <summary>
    /// Stop the web server without deadlocking the UI thread on shutdown.
    /// Runs the async stop on a thread-pool thread with a bounded wait.
    /// </summary>
    public static void Stop()
    {
        if (_app is null) return;
        try
        {
            Task.Run(async () => await _app.StopAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false))
                .Wait(TimeSpan.FromSeconds(5));
            Log.Info("HTTP server stopped");
        }
        catch (Exception ex)
        {
            Log.Error("HTTP server stop error", ex);
        }
    }
}
