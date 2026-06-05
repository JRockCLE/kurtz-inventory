using System.Drawing;
using System.Runtime.InteropServices;
using LdtScanAgent.Models;

namespace LdtScanAgent.Services;

/// <summary>
/// WIA scanner driver wrapper.
///
/// ALL methods on this class MUST be called from <see cref="StaScannerExecutor"/>'s
/// STA worker thread. WIA is single-threaded COM; calling these methods on a
/// thread-pool thread is undefined behavior and the source of most random failures.
///
/// Every method explicitly releases its COM objects in `finally` blocks. RCW
/// (Runtime Callable Wrapper) garbage collection is non-deterministic, and a
/// reclaimed-too-late wrapper holds the scanner's WIA session lock — that's the
/// "device busy" mode where the first scan works and the second one fails.
/// </summary>
public class ScannerService
{
    private const int WIA_DPS_DOCUMENT_HANDLING_SELECT       = 3088;
    private const int WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES = 3086;
    private const int WIA_DPS_PAGES                          = 3096;
    private const int WIA_DPS_PAGE_SIZE                      = 3097;  // device-level (Canon's choice)
    private const int WIA_IPA_DATATYPE                       = 4103;
    private const int WIA_IPA_DEPTH                          = 4104;
    private const int WIA_IPS_CUR_INTENT                     = 6146;
    private const int WIA_IPS_XRES                           = 6147;
    private const int WIA_IPS_YRES                           = 6148;
    private const int WIA_IPS_XPOS                           = 6149;
    private const int WIA_IPS_YPOS                           = 6150;
    private const int WIA_IPS_XEXTENT                        = 6151;
    private const int WIA_IPS_YEXTENT                        = 6152;

    // WIA data types (4103 = WIA_IPA_DATATYPE)
    private const int DATATYPE_THRESHOLD = 0; // 1-bit B&W
    private const int DATATYPE_DITHER    = 1;
    private const int DATATYPE_GRAYSCALE = 2; // 8-bit grayscale
    private const int DATATYPE_COLOR     = 3; // 24-bit color
    // Note: 6157 is WIA_IPS_ROTATION, NOT page size. WIA_IPS_PAGE_SIZE (6158)
    // exists in WIA 2.0 but many drivers (Canon MF-series) don't expose it on
    // the item — they keep page size on the device (3097) instead.

    private const int WIA_PAGE_A4     = 0;
    private const int WIA_PAGE_LETTER = 1;
    private const int WIA_PAGE_LEGAL  = 2;
    private const int WIA_PAGE_AUTO   = 100;

    private const int FEEDER  = 0x01;
    private const int FLATBED = 0x02;

    private const int CAP_FEEDER  = 0x01;
    private const int CAP_FLATBED = 0x02;
    private const int CAP_DUPLEX  = 0x10;

    private const int INTENT_COLOR     = 0x01;
    private const int INTENT_GRAYSCALE = 0x02;
    private const int INTENT_TEXT      = 0x04;

    private const string FORMAT_JPEG = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}";
    private const string FORMAT_BMP  = "{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}";
    private const string FORMAT_PNG  = "{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}";

    private static dynamic CreateDeviceManager()
    {
        var type = Type.GetTypeFromProgID("WIA.DeviceManager")
            ?? throw new InvalidOperationException("WIA.DeviceManager not found. Is the Windows Image Acquisition service running?");
        return Activator.CreateInstance(type)!;
    }

    /// <summary>
    /// Dump every property the scanner exposes — device-level and item-level —
    /// for diagnostics. Used to figure out which WIA properties a finicky
    /// driver actually accepts.
    /// </summary>
    public ScannerDebugDump DebugDump(string scannerId)
    {
        var dump = new ScannerDebugDump { ScannerId = scannerId };
        dynamic? manager = null;
        dynamic? deviceInfos = null;
        dynamic? targetInfo = null;
        dynamic? device = null;
        dynamic? deviceItems = null;
        try
        {
            manager = CreateDeviceManager();
            deviceInfos = manager.DeviceInfos;
            int count = deviceInfos.Count;
            for (int i = 1; i <= count; i++)
            {
                dynamic info = deviceInfos[i];
                if ((string)info.DeviceID == scannerId) { targetInfo = info; break; }
                ReleaseCom(info);
            }
            if (targetInfo is null) throw new ScannerNotFoundException(scannerId);

            device = targetInfo.Connect();
            dump.DeviceProperties = DumpProperties(device.Properties);

            deviceItems = device.Items;
            int itemCount = deviceItems?.Count ?? 0;
            dump.ItemCount = itemCount;
            for (int i = 1; i <= itemCount; i++)
            {
                dynamic? item = null;
                try
                {
                    item = deviceItems![i];
                    dump.Items.Add(new ItemDump
                    {
                        Index      = i,
                        Properties = DumpProperties(item.Properties),
                    });
                }
                finally { ReleaseCom(item); }
            }
            return dump;
        }
        finally
        {
            ReleaseCom(deviceItems);
            ReleaseCom(device);
            ReleaseCom(targetInfo);
            ReleaseCom(deviceInfos);
            ReleaseCom(manager);
        }
    }

    private static List<PropertyDump> DumpProperties(dynamic props)
    {
        var result = new List<PropertyDump>();
        if (props is null) return result;
        var rcws = new List<object>();
        try
        {
            int count = props.Count;
            for (int i = 1; i <= count; i++)
            {
                dynamic? p = null;
                try { p = props[i]; } catch { continue; }
                if (p is null) continue;
                rcws.Add(p);
                var d = new PropertyDump();
                try { d.Id = (int)p.PropertyID; } catch { }
                try { d.Name = (string)p.Name; } catch { }
                try { d.Type = ((object?)p.Type)?.ToString() ?? ""; } catch { }
                try { d.Value = p.Value?.ToString() ?? ""; } catch (Exception ex) { d.Value = $"<unreadable: {ex.Message}>"; }
                try { d.ReadOnly = (bool)p.IsReadOnly; } catch { }
                result.Add(d);
            }
        }
        catch (Exception ex) { Log.Warn($"DumpProperties failed: {ex.Message}"); }
        finally { foreach (var r in rcws) ReleaseCom(r); }
        return result;
    }

    public List<ScannerInfo> EnumerateScanners()
    {
        var results = new List<ScannerInfo>();
        dynamic? manager = null;
        dynamic? deviceInfos = null;
        try
        {
            manager = CreateDeviceManager();
            deviceInfos = manager.DeviceInfos;
            int count = deviceInfos.Count;
            Log.Info($"EnumerateScanners: {count} device(s) reported");

            for (int i = 1; i <= count; i++)
            {
                dynamic? info = null;
                try
                {
                    info = deviceInfos[i];
                    results.Add(BuildScannerInfo(info));
                }
                catch (Exception ex)
                {
                    Log.Warn($"Skipping device {i}: {ex.Message}");
                }
                finally
                {
                    ReleaseCom(info);
                }
            }
        }
        finally
        {
            ReleaseCom(deviceInfos);
            ReleaseCom(manager);
        }
        return results;
    }

    private static ScannerInfo BuildScannerInfo(dynamic info)
    {
        dynamic? infoProps = null;
        dynamic? device = null;
        dynamic? deviceItems = null;
        dynamic? firstItem = null;
        dynamic? itemProps = null;
        dynamic? devProps = null;
        try
        {
            infoProps = info.Properties;
            string name = SafeGetStringByName(infoProps, "Name") ?? "Unknown Device";
            string? manufacturer = SafeGetStringByName(infoProps, "Manufacturer");
            string deviceId = (string)info.DeviceID;

            int caps = 0;
            try
            {
                device = info.Connect();
                if (device is not null)
                {
                    deviceItems = device.Items;
                    if (deviceItems is not null && deviceItems.Count > 0)
                    {
                        firstItem = deviceItems![1];
                        itemProps = firstItem.Properties;
                        caps = SafeGetIntById(itemProps, WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES);
                        if (caps == 0)
                        {
                            devProps = device.Properties;
                            caps = SafeGetIntById(devProps, WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Warn($"Could not read caps for '{name}': {ex.Message}");
            }

            bool capsUnknown = caps == 0;
            return new ScannerInfo
            {
                Id           = deviceId,
                DisplayName  = name,
                Manufacturer = manufacturer,
                HasFlatbed   = capsUnknown || (caps & CAP_FLATBED) != 0,
                HasFeeder    = capsUnknown || (caps & CAP_FEEDER)  != 0,
                HasDuplex    = (caps & CAP_DUPLEX) != 0,
            };
        }
        finally
        {
            ReleaseCom(devProps);
            ReleaseCom(itemProps);
            ReleaseCom(firstItem);
            ReleaseCom(deviceItems);
            ReleaseCom(device);
            ReleaseCom(infoProps);
        }
    }

    public ScanResult Scan(ScanRequest req, CancellationToken ct = default)
    {
        string step = "init";
        dynamic? manager = null;
        dynamic? deviceInfos = null;
        dynamic? targetInfo = null;
        dynamic? device = null;
        dynamic? deviceItems = null;
        dynamic? item = null;
        dynamic? itemProps = null;
        dynamic? devProps = null;
        try
        {
            step = "device-manager";
            manager = CreateDeviceManager();

            step = "enumerate-devices";
            deviceInfos = manager.DeviceInfos;
            int count = deviceInfos.Count;

            step = "find-target-device";
            for (int i = 1; i <= count; i++)
            {
                dynamic info = deviceInfos[i];
                if ((string)info.DeviceID == req.ScannerId) { targetInfo = info; break; }
                ReleaseCom(info);
            }
            if (targetInfo is null) throw new ScannerNotFoundException(req.ScannerId ?? "Unknown");

            step = "connect-device";
            device = targetInfo.Connect();
            if (device is null) throw new InvalidOperationException("Connect() returned null.");

            step = "read-scanner-name";
            string scannerName = SafeGetStringByName(targetInfo.Properties, "Name") ?? "Scanner";

            step = "check-items";
            deviceItems = device.Items;
            if (deviceItems is null || deviceItems.Count == 0)
                throw new InvalidOperationException("Scanner reports no scannable items.");

            step = "get-first-item";
            item = deviceItems![1];
            if (item is null) throw new InvalidOperationException("First scan item was null.");

            step = "get-properties";
            itemProps = item.Properties;
            devProps = device.Properties;

            step = "configure-source";
            bool fromFeeder = string.Equals(req.Source, "ADF", StringComparison.OrdinalIgnoreCase)
                           || string.Equals(req.Source, "Feeder", StringComparison.OrdinalIgnoreCase);
            // Set source on devProps. Treat flatbed and ADF identically from here
            // on out — same item, same property writes, same Transfer.
            //
            // CANON LESSONS LEARNED (do NOT re-add these without reading the log):
            //   • Don't re-fetch device.Items[1] after changing source. The Canon
            //     MF-series driver does NOT invalidate the item; re-fetching
            //     hands you a fresh item with different defaults and Transfer
            //     fails with E_INVALIDARG.
            //   • Don't set WIA_DPS_PAGES. Setting it (to either 0 or 1) puts the
            //     Canon driver into a state where Transfer also rejects with
            //     E_INVALIDARG. The feeder transfer loop iterates Transfer() until
            //     IsPaperEmpty fires, which works without PAGES being touched.
            TrySetIntById(devProps, WIA_DPS_DOCUMENT_HANDLING_SELECT,
                fromFeeder ? FEEDER : FLATBED, "DOC_HANDLING_SELECT");

            step = "configure-page-size";
            TrySetIntById(devProps, WIA_DPS_PAGE_SIZE, WIA_PAGE_LETTER, "DEVICE PAGE_SIZE (LETTER)");

            step = "configure-dpi";
            int dpi = req.Dpi ?? 300;
            TrySetIntById(itemProps, WIA_IPS_XRES, dpi, "XRES");
            TrySetIntById(itemProps, WIA_IPS_YRES, dpi, "YRES");

            step = "configure-scan-area";
            int xExtent = (int)(8.5 * dpi);
            int yExtent = (int)(11.0 * dpi);
            TrySetIntById(itemProps, WIA_IPS_XPOS,    0,       "XPOS");
            TrySetIntById(itemProps, WIA_IPS_YPOS,    0,       "YPOS");
            TrySetIntById(itemProps, WIA_IPS_XEXTENT, xExtent, "XEXTENT");
            TrySetIntById(itemProps, WIA_IPS_YEXTENT, yExtent, "YEXTENT");

            step = "configure-color";
            // Set BOTH intent and explicit datatype/depth. Canon's WIA driver
            // does NOT always propagate Intent → DataType/Depth (default is
            // 1-bit THRESHOLD), and Transfer rejects a JPEG/PNG format when
            // the item is still claiming 1-bit pixels. Set them explicitly.
            (int intent, int datatype, int depth) = (req.ColorMode?.ToLowerInvariant()) switch
            {
                "grayscale"     => (INTENT_GRAYSCALE, DATATYPE_GRAYSCALE, 8),
                "blackandwhite" => (INTENT_TEXT,      DATATYPE_THRESHOLD, 1),
                "bw"            => (INTENT_TEXT,      DATATYPE_THRESHOLD, 1),
                _               => (INTENT_COLOR,    DATATYPE_COLOR,    24),
            };
            TrySetIntById(itemProps, WIA_IPS_CUR_INTENT, intent,   "CUR_INTENT");
            TrySetIntById(itemProps, WIA_IPA_DATATYPE,   datatype, "DATATYPE");
            TrySetIntById(itemProps, WIA_IPA_DEPTH,      depth,    "DEPTH");

            step = "build-result";
            var result = new ScanResult
            {
                ScannerName = scannerName,
                Source      = fromFeeder ? "ADF" : "Flatbed",
                Dpi         = dpi,
                ColorMode   = req.ColorMode ?? "Color"
            };

            // Right-before-Transfer snapshot of what we actually have on the item.
            // If this disagrees with what we set above, the driver silently reverted
            // and we know which property to dig into next.
            int gDoc    = SafeGetIntById(devProps,  WIA_DPS_DOCUMENT_HANDLING_SELECT);
            int gPgSize = SafeGetIntById(devProps,  WIA_DPS_PAGE_SIZE);
            int gXres   = SafeGetIntById(itemProps, WIA_IPS_XRES);
            int gYres   = SafeGetIntById(itemProps, WIA_IPS_YRES);
            int gXext   = SafeGetIntById(itemProps, WIA_IPS_XEXTENT);
            int gYext   = SafeGetIntById(itemProps, WIA_IPS_YEXTENT);
            int gDt     = SafeGetIntById(itemProps, WIA_IPA_DATATYPE);
            int gDepth  = SafeGetIntById(itemProps, WIA_IPA_DEPTH);
            int gInt    = SafeGetIntById(itemProps, WIA_IPS_CUR_INTENT);
            Log.Info($"Pre-Transfer snapshot: src(devProps DOC_SEL)={gDoc} pageSz(dev)={gPgSize} xres={gXres} yres={gYres} xext={gXext} yext={gYext} datatype={gDt} depth={gDepth} intent={gInt}");

            Log.Info($"Scan start: scanner='{scannerName}' source={result.Source} dpi={dpi} mode={result.ColorMode}");

            int pageNum = 1;
            if (fromFeeder)
            {
                step = "feeder-transfer-loop";
                while (true)
                {
                    ct.ThrowIfCancellationRequested();
                    dynamic? image = null;
                    try
                    {
                        image = TransferWithFallback(item);
                        result.Pages.Add(ImageToScannedPage(image, pageNum));
                        Log.Info($"Scan page {pageNum} captured ({result.Pages[^1].SizeBytes} bytes, {result.Pages[^1].WidthPx}x{result.Pages[^1].HeightPx})");
                        pageNum++;
                    }
                    catch (COMException ex) when (IsPaperEmpty(ex)) { break; }
                    finally { ReleaseCom(image); }
                }
            }
            else
            {
                step = "flatbed-transfer";
                dynamic? image = null;
                try
                {
                    image = TransferWithFallback(item);
                    result.Pages.Add(ImageToScannedPage(image, pageNum));
                    Log.Info($"Flatbed page captured ({result.Pages[^1].SizeBytes} bytes, {result.Pages[^1].WidthPx}x{result.Pages[^1].HeightPx})");
                }
                finally { ReleaseCom(image); }
            }

            Log.Info($"Scan complete: {result.Pages.Count} page(s), {result.Pages.Sum(p => (long)p.SizeBytes):N0} bytes");
            return result;
        }
        catch (OperationCanceledException)
        {
            Log.Warn($"Scan cancelled at step '{step}'");
            throw;
        }
        catch (ScannerNotFoundException ex)
        {
            Log.Warn($"Scan: scanner not found ({ex.SavedScannerName})");
            throw;
        }
        catch (Exception ex)
        {
            var msg = $"Scan failed at step '{step}': {ex.GetType().Name}: {ex.Message}";
            Log.Error(msg, ex);
            // Surface friendly messages for known HRESULTs
            if (ex is COMException com)
            {
                var friendly = FriendlyCom(com.HResult);
                if (friendly != null) throw new InvalidOperationException($"{msg} ({friendly})", ex);
            }
            throw new InvalidOperationException(msg, ex);
        }
        finally
        {
            // LIFO release of every COM ref we held
            ReleaseCom(devProps);
            ReleaseCom(itemProps);
            ReleaseCom(item);
            ReleaseCom(deviceItems);
            ReleaseCom(device);
            ReleaseCom(targetInfo);
            ReleaseCom(deviceInfos);
            ReleaseCom(manager);
        }
    }

    /// <summary>
    /// Try JPEG, then PNG, then BMP. Driver vendors disagree on which works.
    ///
    /// CRITICAL: preserves the original <see cref="COMException"/> when all
    /// formats fail. The outer feeder loop relies on catching COMException +
    /// IsPaperEmpty(HRESULT) to detect "end of feed" cleanly — wrapping it in
    /// a generic exception here makes that detection silently miss and turns
    /// a healthy end-of-scan into a 500 that discards all the captured pages.
    /// </summary>
    private static dynamic TransferWithFallback(dynamic item)
    {
        Exception? lastError = null;
        foreach (var fmt in new[] { FORMAT_JPEG, FORMAT_PNG, FORMAT_BMP })
        {
            try
            {
                dynamic result = item.Transfer(fmt);
                if (result != null) return result;
            }
            catch (Exception ex)
            {
                lastError = ex;
                var hrTag = "";
                for (var e = ex; e != null; e = e.InnerException)
                    if (e is COMException com) { hrTag = $" hr=0x{com.HResult:X8}"; break; }
                Log.Info($"Transfer fmt={fmt[1..9]}… failed{hrTag}: {ex.Message.Trim()}");
            }
        }
        if (lastError is not null)
        {
            // If there's a COMException anywhere in the chain, surface IT so
            // HRESULT-based handlers (IsPaperEmpty etc.) can match cleanly.
            for (var e = lastError; e != null; e = e.InnerException)
                if (e is COMException) throw e;
            throw lastError;
        }
        throw new InvalidOperationException("All image formats failed.");
    }

    private static ScannedPage ImageToScannedPage(dynamic image, int pageNumber)
    {
        if (image is null) throw new InvalidOperationException("Transfer returned null image.");
        dynamic? vector = null;
        try
        {
            vector = image.FileData;
            if (vector is null) throw new InvalidOperationException("Image FileData was null.");
            byte[] bytes = (byte[])vector.BinaryData;
            if (bytes is null || bytes.Length == 0) throw new InvalidOperationException("Image data was empty.");

            string format = DetectFormat(bytes);
            int width = 0, height = 0;
            try
            {
                using var ms = new MemoryStream(bytes);
                using var bmp = Image.FromStream(ms);
                width = bmp.Width; height = bmp.Height;
            }
            catch { /* dimensions are nice-to-have */ }

            return new ScannedPage
            {
                PageNumber  = pageNumber,
                ImageBase64 = Convert.ToBase64String(bytes),
                Format      = format,
                WidthPx     = width,
                HeightPx    = height,
                SizeBytes   = bytes.Length,
            };
        }
        finally { ReleaseCom(vector); }
    }

    private static string DetectFormat(byte[] bytes)
    {
        if (bytes.Length < 4) return "unknown";
        if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return "jpeg";
        if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return "png";
        if (bytes[0] == 0x42 && bytes[1] == 0x4D) return "bmp";
        return "unknown";
    }

    private static bool IsPaperEmpty(COMException ex)
    {
        // Standard WIA_ERROR_PAPER_EMPTY (0x80210003) + a Canon variant + a
        // belt-and-suspenders message check. The latter handles the case
        // where a driver returns a different HRESULT but the same human-
        // readable message text from the WIA error table.
        if (ex.HResult is unchecked((int)0x80210003) or unchecked((int)0x80210064))
            return true;
        var m = ex.Message ?? "";
        return m.Contains("no documents left in the document feeder", StringComparison.OrdinalIgnoreCase)
            || m.Contains("paper is empty", StringComparison.OrdinalIgnoreCase);
    }

    private static string? FriendlyCom(int hr) => unchecked((uint)hr) switch
    {
        0x80210006 => "scanner offline",
        0x80210007 => "scanner busy with another application",
        0x80210015 => "scanner offline or unplugged",
        0x8021000A => "communication error with scanner",
        0x8021000C => "cover open",
        0x80210066 => "paper jam",
        0x80210067 => "paper problem",
        _ => null,
    };

    private static void ReleaseCom(object? o)
    {
        if (o is null) return;
        try
        {
            if (Marshal.IsComObject(o))
            {
                while (Marshal.ReleaseComObject(o) > 0) { /* drain refcount */ }
            }
        }
        catch { /* never throw from cleanup */ }
    }

    private static string? SafeGetStringByName(dynamic props, string name)
    {
        if (props is null) return null;
        var rcws = new List<object>();
        try
        {
            int count = props.Count;
            for (int i = 1; i <= count; i++)
            {
                dynamic? p = null;
                try { p = props[i]; } catch { continue; }
                if (p is null) continue;
                rcws.Add(p);
                try
                {
                    if ((string)p.Name == name)
                    {
                        var v = p.Value;
                        return v?.ToString();
                    }
                }
                catch { /* skip malformed property */ }
            }
        }
        catch { }
        finally
        {
            foreach (var r in rcws) ReleaseCom(r);
        }
        return null;
    }

    private static int SafeGetIntById(dynamic props, int propId)
    {
        if (props is null) return 0;
        var rcws = new List<object>();
        try
        {
            int count = props.Count;
            for (int i = 1; i <= count; i++)
            {
                dynamic? p = null;
                try { p = props[i]; } catch { continue; }
                if (p is null) continue;
                rcws.Add(p);
                try
                {
                    if ((int)p.PropertyID == propId)
                    {
                        var v = p.Value;
                        return v is null ? 0 : Convert.ToInt32(v);
                    }
                }
                catch { /* skip malformed property */ }
            }
        }
        catch { }
        finally
        {
            foreach (var r in rcws) ReleaseCom(r);
        }
        return 0;
    }

    /// <summary>
    /// Set a WIA property by its numeric ID. Returns true on success, false if
    /// the property was missing or the driver rejected the value. Logs the
    /// outcome so driver-quirk failures aren't silent.
    /// </summary>
    private static bool TrySetIntById(dynamic props, int propId, int value, string label = "")
    {
        if (props is null) { Log.Warn($"TrySet {label} ({propId})={value}: null props"); return false; }
        var rcws = new List<object>();
        bool found = false;
        try
        {
            int count = props.Count;
            for (int i = 1; i <= count; i++)
            {
                dynamic? p = null;
                try { p = props[i]; } catch { continue; }
                if (p is null) continue;
                rcws.Add(p);
                try
                {
                    if ((int)p.PropertyID == propId)
                    {
                        found = true;
                        p.Value = value;
                        Log.Info($"TrySet {label} ({propId})={value}: ok");
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    Log.Warn($"TrySet {label} ({propId})={value}: driver rejected — {ex.GetType().Name}: {ex.Message}");
                    return false;
                }
            }
        }
        catch (Exception ex)
        {
            Log.Warn($"TrySet {label} ({propId})={value}: enumeration failed — {ex.Message}");
        }
        finally
        {
            foreach (var r in rcws) ReleaseCom(r);
        }
        if (!found) Log.Warn($"TrySet {label} ({propId})={value}: property not present on device");
        return false;
    }
}
