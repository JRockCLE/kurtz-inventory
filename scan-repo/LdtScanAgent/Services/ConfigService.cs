using System.Text.Json;
using LdtScanAgent.Models;

namespace LdtScanAgent.Services;

public class ConfigService
{
    private readonly string _configPath;
    private readonly JsonSerializerOptions _jsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public ConfigService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "LDT", "scan-agent");
        Directory.CreateDirectory(dir);
        _configPath = Path.Combine(dir, "config.json");
    }

    public AgentConfig Load()
    {
        if (!File.Exists(_configPath))
            return new AgentConfig();

        try
        {
            var json = File.ReadAllText(_configPath);
            return JsonSerializer.Deserialize<AgentConfig>(json, _jsonOpts) ?? new AgentConfig();
        }
        catch
        {
            // Corrupted config — start fresh rather than crash
            return new AgentConfig();
        }
    }

    public void Save(AgentConfig config)
    {
        var json = JsonSerializer.Serialize(config, _jsonOpts);
        File.WriteAllText(_configPath, json);
    }

    public string ConfigPath => _configPath;
}
