-- Rich sub-status text for the long-running generation stages (especially
-- "composing_plan", which used to sit static for 1-4 minutes with no
-- narration). This is a free-text companion to `stage`/`progress_pct`: it
-- can update independently of a stage transition (e.g. "Found 6 real places
-- worth considering" while still inside grounding_places) without resetting
-- the stage or progress percentage.

ALTER TABLE plan_generation_jobs ADD COLUMN IF NOT EXISTS stage_detail TEXT;
