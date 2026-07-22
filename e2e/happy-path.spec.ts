import { test, expect } from "@playwright/test";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test("signup -> generate -> Love -> Buddy edit -> share -> dislike -> lock -> feedback -> Memory", async ({ page, context }) => {
  const email = uniqueEmail();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await expect(page.getByText("PlanBuddy")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Where are you based?")).toBeVisible();
  await page.getByLabel("Home city").fill("Lisbon");
  const cityOption = page.getByRole("button", { name: /Lisbon/i }).first();
  await expect(cityOption).toBeVisible({ timeout: 10000 });
  await cityOption.click();
  await expect(page.getByText("Who's usually along?")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Optional taste-quiz step: skip it in the happy path (the quiz has its own coverage).
  await expect(page.getByText("Build your fun profile")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect(page.getByText("One click. One genuinely good plan.")).toBeVisible();
  await page.getByRole("button", { name: "Plan my weekend" }).click();

  // Async plan-generation progress: the stage checklist should render, and switching to another
  // tab and back must not reset it (generation state lives in GenerationContext, above the routes,
  // not in PlanPage's own component state).
  const stageOrLockLocator = page.getByText("Reading your household memory").or(page.getByRole("button", { name: /Lock it/i }));
  await expect(stageOrLockLocator.first()).toBeVisible({ timeout: 15000 });
  if (await page.getByText("Reading your household memory").isVisible().catch(() => false)) {
    await page.getByRole("link", { name: "History" }).click();
    await page.getByRole("link", { name: "Plan" }).click();
  }

  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /^Love$/i }).click();
  await expect(page.getByText("PlanBuddy learned")).toBeVisible();

  const originalTitle = await page.locator(".ticket-card h2").first().textContent();
  // The persistent Buddy bubble uses the same edit path, so an in-flight edit can survive
  // navigation without replacing the ticket that is currently on screen.
  await page.getByRole("button", { name: "Open Buddy" }).click();
  await page.getByLabel("Edit this plan with Buddy").fill("Change only the restaurant and keep the walks");
  await page.route("**/api/plan-specs/*/chat-action", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.getByRole("button", { name: "Send plan edit" }).click();
  await expect(page.locator(".ticket-card h2").first()).toHaveText(originalTitle ?? "");
  await expect(page.getByText(/Checking the route, constraints/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to original" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/changed the meal stop/i)).toBeVisible();
  await page.getByRole("button", { name: "Back to original" }).click();
  await expect(page.locator(".ticket-card h2").first()).toHaveText(originalTitle ?? "");
  await page.getByRole("button", { name: "Close Buddy" }).first().click();

  await page.getByRole("button", { name: /^Share$/i }).click();
  await expect(page.getByRole("button", { name: "Shared" })).toBeVisible();

  await page.getByRole("button", { name: /^Dislike$/i }).click();
  await page.getByLabel(/What missed/i).fill("Not feeling it today");
  await page.getByRole("button", { name: "Save and show another" }).click();
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /Lock it/i }).click();
  await expect(page.getByText("It's on.")).toBeVisible();
  await page.getByRole("link", { name: "View in History" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await page.locator(".card").first().click();
  await page.getByRole("button", { name: /^Love$/i }).click();
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByPlaceholder(/Say something/).fill("We are allergic to peanuts");
  await page.getByPlaceholder(/Say something/).press("Enter");
  await expect(page.getByText(/Added to Memory as a constraint/i)).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "Memory" }).click();
  await expect(page.getByText(/peanut/i).first()).toBeVisible();
  await expect(page.getByText("Unverified quote")).toBeVisible();

  // Logout affordance: signed-in email + Log out control at the bottom of Memory, and it actually
  // signs the user out (lands back on the auth page).
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: /Log out/i }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible({ timeout: 10000 });
});

test("plan controls, start over, and learned-hunch editing work on mobile", async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Home city").fill("Lisbon");
  await page.getByRole("button", { name: /Lisbon/i }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip" }).click();

  await page.getByRole("button", { name: /Plan controls/i }).click();
  await expect(page.getByLabel("Search radius")).toBeVisible();
  await page.getByLabel("Search radius").fill("18");
  await page.getByLabel("Meal").selectOption("dinner");
  await page.getByLabel("Walking").selectOption("light");
  await page.getByLabel("Budget").selectOption("25");
  await page.getByLabel("Setting").selectOption("outdoors");
  await page.getByLabel("Getting there").selectOption("public");
  await page.getByLabel("Getting there").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/plan-controls-mobile.png" });
  await page.getByRole("button", { name: "Plan my weekend" }).click();
  await expect(page.getByRole("button", { name: /Lock it/i })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /^Love$/i }).click();
  await expect(page.getByText("PlanBuddy learned")).toBeVisible();

  await page.getByRole("button", { name: /Start over/i }).click();
  await expect(page.getByText("One click. One genuinely good plan.")).toBeVisible();
  await expect(page.getByLabel("Anything different this time? Optional")).toHaveValue("");

  await page.getByRole("link", { name: "Memory" }).click();
  await page.getByRole("button", { name: "Hunches" }).click();
  const hunchCard = page.locator(".card").filter({ has: page.getByText(/confidence/i) }).first();
  await expect(hunchCard).toBeVisible();
  await hunchCard.getByTitle("Edit").click();
  await hunchCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/hunch-editor-mobile.png" });
  await hunchCard.getByLabel("Hunch text").fill("edited preference for quiet green routes");
  await hunchCard.getByTitle("Save changes").click();
  await expect(page.getByText("edited preference for quiet green routes")).toBeVisible();
  await hunchCard.getByTitle("Delete permanently").click();
  await expect(page.getByText("edited preference for quiet green routes")).toHaveCount(0);
});
