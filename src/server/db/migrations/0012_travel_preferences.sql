-- How far from home the user is happy to go, per kind of outing (null = the app default for the scale).
ALTER TABLE users ADD COLUMN IF NOT EXISTS travel_day_km INTEGER
;

ALTER TABLE users ADD COLUMN IF NOT EXISTS travel_weekend_km INTEGER
;
