namespace LdtScanAgent.Models;

public class AgentConfig
{
    public bool Configured { get; set; } = false;
    public DateTime? ConfiguredAt { get; set; }
    public ScannerRef? DefaultScanner { get; set; }
    public string? DefaultSource { get; set; }       // "Flatbed" | "ADF"
    public int? DefaultDpi { get; set; }             // 150, 200, 300, 600
    public string? DefaultColorMode { get; set; }    // "Color" | "Grayscale" | "BlackAndWhite"
}

public class ScannerRef
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
}

public class ScannerInfo
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Manufacturer { get; set; }
    public bool HasFlatbed { get; set; }
    public bool HasFeeder { get; set; }
    public bool HasDuplex { get; set; }
}

public class ScanRequest
{
    public string? ScannerId { get; set; }
    public string? Source { get; set; }       // "Flatbed" | "ADF"
    public int? Dpi { get; set; }
    public string? ColorMode { get; set; }
    public bool? Duplex { get; set; }
}

public class ScanResult
{
    public string ScanId { get; set; } = Guid.NewGuid().ToString();
    public DateTime ScannedAt { get; set; } = DateTime.UtcNow;
    public string Hostname { get; set; } = Environment.MachineName;
    public string ScannerName { get; set; } = "";
    public string Source { get; set; } = "";
    public int Dpi { get; set; }
    public string ColorMode { get; set; } = "";
    public List<ScannedPage> Pages { get; set; } = new();
}

public class ScannedPage
{
    public int PageNumber { get; set; }
    public string ImageBase64 { get; set; } = "";
    public string Format { get; set; } = "jpeg";  // "jpeg" or "png"
    public int WidthPx { get; set; }
    public int HeightPx { get; set; }
    public int SizeBytes { get; set; }
}

public class ScannerDebugDump
{
    public string ScannerId { get; set; } = "";
    public int ItemCount { get; set; }
    public List<PropertyDump> DeviceProperties { get; set; } = new();
    public List<ItemDump> Items { get; set; } = new();
}

public class ItemDump
{
    public int Index { get; set; }
    public List<PropertyDump> Properties { get; set; } = new();
}

public class PropertyDump
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string Value { get; set; } = "";
    public bool ReadOnly { get; set; }
}

public class ScannerNotFoundException : Exception
{
    public string SavedScannerName { get; }

    public ScannerNotFoundException(string savedName)
        : base($"Configured scanner '{savedName}' is not currently available.")
    {
        SavedScannerName = savedName;
    }
}

public class ScannerBusyException : Exception
{
    public ScannerBusyException()
        : base("Scanner is busy with another request.") { }
}
