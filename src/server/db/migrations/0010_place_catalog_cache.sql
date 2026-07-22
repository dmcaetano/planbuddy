-- Durable cache for broad OpenStreetMap/Overpass place discovery. Keeping the
-- catalog in Neon means a Render cold start does not collapse back to a tiny
-- hand-authored route list or wait on a large radius query.

CREATE TABLE IF NOT EXISTS place_catalog_cache (
  cache_key TEXT PRIMARY KEY,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
