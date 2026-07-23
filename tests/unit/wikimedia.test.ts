import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWikimediaImage } from "../../src/server/media/wikimedia.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function commonsResponse(title: string) {
  return {
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "1": {
            index: 1,
            title: `File:${title}.jpg`,
            imageinfo: [{
              thumburl: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`,
              descriptionurl: "https://commons.wikimedia.org/wiki/File:example.jpg",
              extmetadata: {
                Artist: { value: "Example photographer" },
                LicenseShortName: { value: "CC BY-SA 4.0" },
              },
            }],
          },
        },
      },
    }),
  };
}

describe("Wikimedia hero image lookup", () => {
  it("uses the supplied location instead of silently appending Lisbon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(commonsResponse("Praia de Faro"));
    vi.stubGlobal("fetch", fetchMock);

    const image = await resolveWikimediaImage(
      "Praia de Faro Portugal",
      "Faro Portugal cityscape"
    );

    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as URL);
    expect(requestedUrl.searchParams.get("gsrsearch")).toBe("Praia de Faro Portugal");
    expect(requestedUrl.searchParams.get("gsrsearch")).not.toMatch(/Lisbon/i);
    expect(image?.caption).toBe("Praia de Faro");
  });

  it("falls back to a city image when an obscure route stop has no Commons photo", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ query: { pages: {} } }) })
      .mockResolvedValueOnce(commonsResponse("Lisbon skyline"));
    vi.stubGlobal("fetch", fetchMock);

    const image = await resolveWikimediaImage(
      "Obscure neighbourhood garden Portugal",
      "Lisbon Portugal cityscape"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackUrl = new URL(fetchMock.mock.calls[1][0] as URL);
    expect(fallbackUrl.searchParams.get("gsrsearch")).toBe("Lisbon Portugal cityscape");
    expect(image?.url).toContain("Lisbon%20skyline");
  });

  it("still supplies a city hero when the planner omitted its photo term", async () => {
    const fetchMock = vi.fn().mockResolvedValue(commonsResponse("Lisbon cityscape"));
    vi.stubGlobal("fetch", fetchMock);

    const image = await resolveWikimediaImage(null, "Lisbon Portugal cityscape");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(image?.caption).toBe("Lisbon cityscape");
  });
});
