export type NewPlanScope = "tonight" | "day" | "weekend" | null;

/** Asks Home to have the Planner worker build a fresh plan; opens Home first when we are elsewhere. */
export function requestNewPlan(scope: NewPlanScope, onHome: boolean, navigate: (to: string) => void) {
  if (onHome) {
    window.dispatchEvent(new CustomEvent("planbuddy:new-plan", { detail: { scope } }));
    return;
  }
  sessionStorage.setItem("planbuddy:new-plan", scope ?? "1");
  navigate("/");
}
