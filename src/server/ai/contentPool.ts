export interface LocalTemplate {
  id: string;
  category: string;
  indoor: boolean;
  tags: string[];
  title: string;
  rationale: string;
  beat: { title: string; description: string };
}

export interface TripTemplate {
  id: string;
  category: string;
  indoor: boolean;
  tags: string[];
  title: string;
  rationale: string;
  destinationAnchor: string;
  beats: { title: string; description: string; indoor: boolean }[];
}

// `tags` double as demo mood-matching keywords and, deliberately for a few
// entries, as constraint-filter exercise cases (e.g. "peanut", "shellfish").
export const LOCAL_TEMPLATES: LocalTemplate[] = [
  {
    id: "park-picnic",
    category: "outdoors",
    indoor: false,
    tags: ["relax", "nature", "family", "free", "quiet"],
    title: "Picnic and wander at the riverside park",
    rationale: "An easy, low-cost outdoor stretch with room for kids and pets to roam.",
    beat: { title: "Riverside park picnic", description: "Pack a simple lunch and claim a shady spot by the water; bring a frisbee or a deck of cards." },
  },
  {
    id: "museum-afternoon",
    category: "culture",
    indoor: true,
    tags: ["culture", "rainy-day", "quiet", "learning"],
    title: "Slow afternoon at the local museum",
    rationale: "Indoor, unhurried, and a reliable pick when the weather turns.",
    beat: { title: "Museum wander", description: "Start with the current special exhibit, then let the group split up and regroup at the cafe." },
  },
  {
    id: "farmers-market",
    category: "food",
    indoor: false,
    tags: ["food", "morning", "family", "local"],
    title: "Saturday farmers market breakfast crawl",
    rationale: "Casual, walkable, and easy to adjust on the fly for pickier eaters.",
    beat: { title: "Market breakfast crawl", description: "Graze from stall to stall for breakfast, then grab produce for the week." },
  },
  {
    id: "board-game-cafe",
    category: "social",
    indoor: true,
    tags: ["social", "rainy-day", "cozy"],
    title: "Board game cafe afternoon",
    rationale: "Low-key and social, with a menu that works for most diets.",
    beat: { title: "Board game cafe", description: "Grab a table, order snacks, and work through a couple of games at your own pace." },
  },
  {
    id: "hiking-trail",
    category: "active",
    indoor: false,
    tags: ["active", "nature", "morning"],
    title: "Morning loop on the ridge trail",
    rationale: "A moderate hike that rewards early starters with quieter trails.",
    beat: { title: "Ridge trail hike", description: "A 6km loop with a lookout roughly halfway; bring water and layers." },
  },
  {
    id: "thai-peanut-crawl",
    category: "food",
    indoor: true,
    tags: ["food", "spicy", "peanut", "evening"],
    title: "Thai peanut noodle food crawl",
    rationale: "A flavor-forward evening built around a couple of neighborhood favorites, including a peanut-sauce noodle bar.",
    beat: { title: "Peanut noodle bar stop", description: "Start with the peanut-sauce noodles the place is known for, then move to a nearby spot for dessert." },
  },
  {
    id: "seaside-shellfish-shack",
    category: "food",
    indoor: false,
    tags: ["food", "seafood", "shellfish", "coastal"],
    title: "Seaside boardwalk and shellfish shack",
    rationale: "A breezy boardwalk walk that ends at a well-reviewed shellfish shack.",
    beat: { title: "Boardwalk and shellfish shack", description: "Walk the boardwalk, then share a bucket of steamed shellfish at the end." },
  },
  {
    id: "climbing-gym",
    category: "active",
    indoor: true,
    tags: ["active", "rainy-day", "adrenaline"],
    title: "Bouldering session at the climbing gym",
    rationale: "High-energy and indoors, good for a group that wants to move.",
    beat: { title: "Bouldering session", description: "Warm up on easier routes, then take turns spotting each other on harder problems." },
  },
  {
    id: "dog-park-brewery",
    category: "social",
    indoor: false,
    tags: ["pet-friendly", "social", "alcohol", "afternoon"],
    title: "Dog park loop then brewery patio",
    rationale: "Lets the dog run first, then a relaxed pet-friendly patio for the humans, including a beer flight.",
    beat: { title: "Dog park and brewery patio", description: "An hour at the off-leash park, then a pet-friendly brewery patio nearby for a beer flight and snacks." },
  },
  {
    id: "yoga-spa",
    category: "wellness",
    indoor: true,
    tags: ["relax", "wellness", "quiet"],
    title: "Restorative yoga and spa afternoon",
    rationale: "A gentle, low-stimulation option for a genuinely restful day.",
    beat: { title: "Yoga and spa", description: "A drop-in restorative class followed by a sauna or soak, unhurried." },
  },
  {
    id: "aquarium-visit",
    category: "culture",
    indoor: true,
    tags: ["family", "rainy-day", "learning"],
    title: "Aquarium morning",
    rationale: "Reliable, indoor, and works well across a wide age range.",
    beat: { title: "Aquarium visit", description: "Aim for the touch-tank feeding time, then work through the exhibits at a relaxed pace." },
  },
  {
    id: "art-studio-class",
    category: "culture",
    indoor: true,
    tags: ["creative", "rainy-day", "quiet"],
    title: "Drop-in pottery or paint studio session",
    rationale: "A hands-on, low-pressure creative outlet that ends with something to take home.",
    beat: { title: "Studio drop-in session", description: "A two-hour guided session, materials included, no experience required." },
  },
];

export const TRIP_TEMPLATES: TripTemplate[] = [
  {
    id: "mountain-cabin",
    category: "nature",
    indoor: false,
    tags: ["nature", "quiet", "cabin"],
    title: "Mountain cabin reset",
    rationale: "A slower-paced trip built around trails, a fire pit, and genuinely disconnecting.",
    destinationAnchor: "a lakeside mountain town",
    beats: [
      { title: "Arrival and trailhead scout", description: "Settle into the cabin, then scout the nearest easy trailhead for tomorrow.", indoor: false },
      { title: "Ridge hike and lake swim", description: "A half-day hike with a swim spot partway, back for an early dinner.", indoor: false },
      { title: "Slow morning and drive home", description: "A relaxed breakfast, a short town walk, then the drive back.", indoor: true },
    ],
  },
  {
    id: "coastal-town",
    category: "coastal",
    indoor: false,
    tags: ["coastal", "food", "seafood"],
    title: "Coastal town escape",
    rationale: "Walkable coastal town with a strong food scene, anchored by a well-known seafood market.",
    destinationAnchor: "a small coastal harbor town",
    beats: [
      { title: "Harbor walk and seafood market", description: "Wander the harbor, then lunch at the seafood market stalls.", indoor: false },
      { title: "Beach afternoon", description: "A slow beach afternoon with a swim if the water's warm enough.", indoor: false },
      { title: "Sunset dinner and boardwalk", description: "An early dinner with a water view, then a boardwalk stroll.", indoor: true },
    ],
  },
  {
    id: "wine-country",
    category: "food",
    indoor: false,
    tags: ["food", "alcohol", "scenic"],
    title: "Wine country weekend",
    rationale: "A relaxed pace of vineyard visits with a scenic countryside drive.",
    destinationAnchor: "a nearby wine region",
    beats: [
      { title: "Vineyard tasting", description: "A late-morning tasting at a small, low-key vineyard.", indoor: false },
      { title: "Countryside picnic drive", description: "A scenic drive with a picnic stop overlooking the vines.", indoor: false },
      { title: "Farm-to-table dinner", description: "Dinner at a restaurant sourcing from the surrounding farms.", indoor: true },
    ],
  },
  {
    id: "historic-capital",
    category: "culture",
    indoor: true,
    tags: ["culture", "learning", "walkable"],
    title: "Historic capital city break",
    rationale: "Dense, walkable old-town core with museums as a rainy-day fallback.",
    destinationAnchor: "a historic capital city",
    beats: [
      { title: "Old town walking tour", description: "A self-paced walk through the historic core, stopping wherever looks interesting.", indoor: false },
      { title: "Flagship museum", description: "The city's flagship museum, with a break in its courtyard cafe.", indoor: true },
      { title: "Neighborhood dinner", description: "Dinner in a neighborhood known for its local, unpretentious spots.", indoor: true },
    ],
  },
  {
    id: "theme-park",
    category: "family",
    indoor: false,
    tags: ["family", "active", "adrenaline"],
    title: "Theme park adventure",
    rationale: "High-energy and structured, good for a group that wants a packed itinerary.",
    destinationAnchor: "a regional theme park destination",
    beats: [
      { title: "Rope-drop rides", description: "Arrive early to clear the headline rides before the lines build.", indoor: false },
      { title: "Shows and shade breaks", description: "Alternate shows and indoor attractions through the hot part of the day.", indoor: true },
      { title: "Evening finale", description: "Save the second big ride and any evening show for the cooler hours.", indoor: false },
    ],
  },
  {
    id: "lakeside-cabin",
    category: "nature",
    indoor: false,
    tags: ["nature", "pet-friendly", "quiet"],
    title: "Lakeside cabin, dog welcome",
    rationale: "A pet-friendly cabin with lake access and easy, low-key days.",
    destinationAnchor: "a lakeside cabin community",
    beats: [
      { title: "Lake swim and dock time", description: "An easy first afternoon at the dock, dog included.", indoor: false },
      { title: "Trail loop with the dog", description: "A dog-friendly loop trail circling the lake.", indoor: false },
      { title: "Campfire evening", description: "A simple cooked-over-the-fire dinner and an early night.", indoor: false },
    ],
  },
  {
    id: "tropical-resort",
    category: "beach",
    indoor: false,
    tags: ["beach", "seafood", "relax"],
    title: "Tropical beach reset",
    rationale: "A genuinely restful beach trip with a well-reviewed seafood shack nearby.",
    destinationAnchor: "a tropical beach town",
    beats: [
      { title: "Beach and reef snorkel", description: "A shallow reef snorkel spot good for mixed experience levels.", indoor: false },
      { title: "Hammock afternoon", description: "An unscheduled afternoon: hammocks, a paperback, nothing planned.", indoor: false },
      { title: "Seafood shack dinner", description: "Dinner at the beach's well-known seafood shack, feet in the sand.", indoor: false },
    ],
  },
  {
    id: "national-park",
    category: "nature",
    indoor: false,
    tags: ["nature", "active", "scenic"],
    title: "National park long weekend",
    rationale: "Big scenery with a mix of easy overlooks and one longer hike.",
    destinationAnchor: "a national park gateway town",
    beats: [
      { title: "Scenic overlook drive", description: "Hit two or three of the park's marquee overlooks on arrival day.", indoor: false },
      { title: "Signature day hike", description: "The park's best-known moderate day hike, started early to beat the heat.", indoor: false },
      { title: "Gateway town wind-down", description: "A relaxed dinner in the gateway town before the drive home.", indoor: true },
    ],
  },
];
