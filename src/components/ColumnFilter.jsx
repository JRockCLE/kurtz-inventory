import { useState, useEffect, useRef, useCallback } from "react";

const SB_URL = "https://veqsqzzymxjniagodkey.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcXNxenp5bXhqbmlhZ29ka2V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQ5NDIxOCwiZXhwIjoyMDkxMDcwMjE4fQ.05MhQ5FB1jEV05f435JhTMn61yEWmzPU22add0tBP64";

async function fetchSuggestions(column, typed) {
  if (!typed || typed.length < 1) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/rpc/distinct_column_values`,
    {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        "Accept-Profile": "posbe",
        "Content-Profile": "posbe",
      },
      body: JSON.stringify({ col_name: column, prefix: typed }),
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.map(r => r.val).filter(Boolean);
}

export default function ColumnFilter({ column, placeholder, activeValue, onApply, className = "" }) {
  const [inputVal, setInputVal] = useState(activeValue || "");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const fetchTimer = useRef(null);

  useEffect(() => {
    setInputVal(activeValue || "");
  }, [activeValue]);

  const fetchDebounced = useCallback((val) => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (!val || val.length < 1) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    fetchTimer.current = setTimeout(() => {
      fetchSuggestions(column, val)
        .then(results => {
          setSuggestions(results);
          setHighlightIdx(-1);
          setShowDropdown(true);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 200);
  }, [column]);

  const handleChange = (e) => {
    const val = e.target.value;
    setInputVal(val);
    fetchDebounced(val);
  };

  const applyFilter = (val) => {
    const trimmed = (val || "").trim();
    onApply(trimmed);
    setShowDropdown(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
        setInputVal(suggestions[highlightIdx]);
        applyFilter(suggestions[highlightIdx]);
      } else {
        applyFilter(inputVal);
      }
    } else if (e.key === "Escape") {
      if (showDropdown) {
        setShowDropdown(false);
      } else {
        setInputVal("");
        applyFilter("");
      }
    } else if (e.key === "Delete" && inputVal === "") {
      applyFilter("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(prev => Math.max(prev - 1, -1));
    }
  };

  const handleSelect = (val) => {
    setInputVal(val);
    applyFilter(val);
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (inputVal && suggestions.length > 0) {
      setShowDropdown(true);
    } else if (inputVal) {
      fetchDebounced(inputVal);
    }
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = !!activeValue;

  return (
    <th className={`px-1 py-1 relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={inputVal}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-amber-500 ${
          isActive
            ? "border-amber-400 bg-amber-50 text-amber-800 font-medium"
            : "border-stone-200 text-stone-600 bg-white"
        }`}
      />
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-1 right-1 mt-0.5 bg-white border border-stone-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto"
        >
          {suggestions.map((val, idx) => (
            <button
              key={`${val}-${idx}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(val); }}
              className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                idx === highlightIdx
                  ? "bg-amber-100 text-amber-800"
                  : "text-stone-700 hover:bg-stone-50"
              }`}
            >
              {val}
            </button>
          ))}
        </div>
      )}
      {showDropdown && loading && inputVal && suggestions.length === 0 && (
        <div className="absolute top-full left-1 right-1 mt-0.5 bg-white border border-stone-200 rounded-lg shadow-lg z-50 px-3 py-2 text-xs text-stone-400">
          Searching...
        </div>
      )}
    </th>
  );
}
