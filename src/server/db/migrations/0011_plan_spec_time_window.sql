-- One-tap "plan the time I have left" requests carry a usable clock window,
-- not just a date range: a plan started at 18:15 must not open with a morning
-- walk. Stored as local "HH:MM" strings alongside the spec's local dates, so a
-- revision or regenerate of the same spec keeps planning inside the same hours.

ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE plan_specs ADD COLUMN IF NOT EXISTS end_time TEXT;
