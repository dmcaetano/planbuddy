ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_status_check
;

ALTER TABLE plans ADD CONSTRAINT plans_status_check
  CHECK (status IN ('suggested', 'locked', 'rejected'))
;

-- Every historical rank-1 candidate was the winner returned to the user for
-- that generation batch. Recover those previously surfaced-but-unlocked
-- suggestions so the new novelty loop remembers them immediately.
INSERT INTO plans (
  id, user_id, plan_spec_id, candidate_id, status, title, rationale, category,
  beats, weather, distance_km, place_provenance, active_constraints,
  rejection_reason, locked_at, created_at
)
SELECT
  'suggested-' || c.id,
  ps.user_id,
  c.plan_spec_id,
  c.id,
  'suggested',
  c.payload->>'title',
  c.payload->>'rationale',
  c.payload->>'category',
  c.payload->'beats',
  NULL,
  NULLIF(c.payload->>'travelEstimateKm', '')::DOUBLE PRECISION,
  jsonb_build_object(
    'mode', CASE WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(c.payload->'beats', '[]'::jsonb)) AS beat
      WHERE beat->'place'->>'sourceUrl' IS NOT NULL
    ) THEN 'resolved' ELSE 'inspiration' END,
    'note', 'Recovered from a previously shown PlanBuddy suggestion.'
  ),
  '[]'::jsonb,
  NULL,
  NULL,
  c.created_at
FROM candidates c
JOIN plan_specs ps ON ps.id = c.plan_spec_id
WHERE c.rank = 1
  AND c.rejected = false
  AND NOT EXISTS (
    SELECT 1 FROM plans p
    WHERE p.candidate_id = c.id OR p.id = 'suggested-' || c.id
  )
;

CREATE INDEX IF NOT EXISTS idx_plans_user_created
  ON plans(user_id, created_at DESC)
;
