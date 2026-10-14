// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { dedupeHits, normalizeUrl, SearchError, webSearch } from "./providers";

const fetchMock = vi.fn<typeof fetch>();
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});
const reply = (body: unknown, status = 200) => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
};

describe("normalizeUrl", () => {
  it("drops tracking parameters, fragments, and trailing slashes, and refuses other schemes", () => {
    expect(normalizeUrl("https://Example.com/a/?utm_source=x&id=2#top")).toBe("https://example.com/a?id=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://example.com/file")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("treats tracked and plain links as the same page", () => {
    const hits = dedupeHits([
      { title: "A", url: "https://example.com/post?utm_campaign=z", snippet: "" },
      { title: "A again", url: "https://EXAMPLE.com/post/#comments", snippet: "" },
      { title: "B", url: "https://example.org/post", snippet: "" },
      { title: "Bad", url: "javascript:1", snippet: "" },
    ]);
    expect(hits.map((h) => h.title)).toEqual(["A", "B"]);
  });
});

describe("webSearch", () => {
  it("asks Brave with the key in a header and reads its results", async () => {
    reply({ web: { results: [{ title: "Solar <b>power</b>", url: "https://a.test/solar", description: "A <i>great</i> overview." }, { title: "", url: "https://skip.test" }, { title: "No url" }] } });
    const hits = await webSearch({ provider: "brave", apiKey: "BSA-key" }, "solar power", { count: 3 });
    expect(hits).toEqual([{ title: "Solar power", url: "https://a.test/solar", snippet: "A great overview." }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.search.brave.com/res/v1/web/search");
    expect(String(url)).toContain("q=solar+power");
    expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("BSA-key");
    expect(String(url)).not.toContain("BSA-key");
  });

  it("asks Tavily with the key as a bearer token", async () => {
    reply({ results: [{ title: "Wind", url: "https://w.test", content: "Wind facts" }] });
    expect(await webSearch({ provider: "tavily", apiKey: "tvly-key" }, "wind")).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tvly-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: "wind" });
  });

  it("asks a SearXNG instance for JSON, and needs its address", async () => {
    reply({ results: [{ title: "Local", url: "https://l.test", content: "From my instance" }] });
    expect(await webSearch({ provider: "searxng", baseUrl: "http://searx.lan:8080/" }, "q")).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://searx.lan:8080/search?q=q&format=json");
    await expect(webSearch({ provider: "searxng", baseUrl: "" }, "q")).rejects.toThrow(/address of your SearXNG/);
  });

  it("explains failures in plain words, without echoing the key", async () => {
    reply({}, 401);
    await expect(webSearch({ provider: "brave", apiKey: "secret-key-123" }, "q")).rejects.toMatchObject({ kind: "key_rejected", message: "The search service rejected the API key." });
    reply({}, 429);
    await expect(webSearch({ provider: "brave", apiKey: "k" }, "q")).rejects.toMatchObject({ kind: "rate_limited" });
    reply({}, 500);
    await expect(webSearch({ provider: "tavily", apiKey: "k" }, "q")).rejects.toMatchObject({ kind: "unavailable" });
    reply({ web: { results: "nope" } });
    await expect(webSearch({ provider: "brave", apiKey: "k" }, "q")).rejects.toBeInstanceOf(SearchError);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(webSearch({ provider: "tavily", apiKey: "k" }, "q")).rejects.toMatchObject({ kind: "unavailable", message: "The search service couldn't be reached." });
  });
});
