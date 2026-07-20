-- Adds an 'onboarding_quiz' provenance value so the optional tap-first
-- taste quiz can write tastes/constraints that are distinguishable from
-- manually typed or chat-extracted memory (needed to support "retake
-- replaces, never duplicates").

ALTER TABLE tastes DROP CONSTRAINT IF EXISTS tastes_source_check
;

ALTER TABLE tastes ADD CONSTRAINT tastes_source_check
  CHECK (source IN ('stated', 'onboarding', 'promoted', 'onboarding_quiz'))
;

ALTER TABLE constraints DROP CONSTRAINT IF EXISTS constraints_source_check
;

ALTER TABLE constraints ADD CONSTRAINT constraints_source_check
  CHECK (source IN ('typed', 'chat', 'onboarding_quiz'))
;
