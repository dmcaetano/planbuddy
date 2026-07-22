import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MapPin } from "lucide-react";

export interface GeocodeChoice {
  label: string;
  lat: number;
  lng: number;
}

interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Debounced city search against /weather/geocode — the same flow onboarding
 * uses to set the home base, extracted so Memory and Plan can reuse it.
 */
export default function CitySearch({
  placeholder,
  onChoose,
  autoFocus,
}: {
  placeholder?: string;
  onChoose: (choice: GeocodeChoice) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const data = await api.get<{ results: GeocodeResult[] }>(`/weather/geocode?q=${encodeURIComponent(query)}`);
        setResults(data.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="city-search">
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? "Search for a city"}
        aria-label={placeholder ?? "Search for a city"}
        autoFocus={autoFocus}
      />
      {searching && <p className="muted">Searching…</p>}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="muted">No places found — try a broader name.</p>
      )}
      {results.length > 0 && (
        <div className="city-search-results" role="listbox">
          {results.map((r) => (
            <button
              key={`${r.label}-${r.lat}-${r.lng}`}
              type="button"
              className="city-search-result"
              onClick={() => onChoose({ label: r.label, lat: r.lat, lng: r.lng })}
            >
              <MapPin size={14} /> {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
