import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Candidate } from "../api/types";

/** The routed Plan page tells the persistent Buddy shell which plan is in view. */
export interface FocusedPlan {
  specId: string;
  candidate: Candidate;
}

interface PlanFocusValue {
  focusedPlan: FocusedPlan | null;
  setFocusedPlan: (plan: FocusedPlan | null) => void;
}

const PlanFocusContext = createContext<PlanFocusValue | null>(null);

export function PlanFocusProvider({ children }: { children: ReactNode }) {
  const [focusedPlan, setFocusedPlanState] = useState<FocusedPlan | null>(null);
  const setFocusedPlan = useCallback((next: FocusedPlan | null) => {
    setFocusedPlanState((previous) => {
      if (previous?.specId === next?.specId && previous?.candidate.id === next?.candidate.id) return previous;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ focusedPlan, setFocusedPlan }), [focusedPlan, setFocusedPlan]);
  return <PlanFocusContext.Provider value={value}>{children}</PlanFocusContext.Provider>;
}

export function usePlanFocus(): PlanFocusValue {
  const value = useContext(PlanFocusContext);
  if (!value) throw new Error("usePlanFocus must be used within PlanFocusProvider");
  return value;
}
