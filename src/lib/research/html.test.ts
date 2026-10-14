import { describe, expect, it } from "vitest";
import { decodeEntities, extractReadable } from "./html";

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities, and leaves unknown ones", () => {
    expect(decodeEntities("Fish &amp; chips &lt;3 &#169; &#x2014; &hellip; &unknown;")).toBe("Fish & chips <3 © — … &unknown;");
    expect(decodeEntities("&#0; &#99999999999;")).toBe(" ");
  });
});

const page = `<!doctype html><html><head><title>Solar &amp; wind: a primer</title>
<style>.x{color:red}</style><script>alert("steal cookies")</script></head>
<body>
<header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
<main>
  <article>
    <h1>Solar power is getting cheaper</h1>
    <p>The cost of solar panels has fallen by roughly ninety percent over the last decade, which has changed how utilities plan new capacity.</p>
    <p>Wind power followed a similar curve, although offshore projects remain more expensive than onshore ones.</p>
    <form><label>Email</label><input name="email"><button>Subscribe to our newsletter today</button></form>
    <ul><li>Panels are recycled at the end of their life.</li><li>Batteries smooth out the daily peak.</li></ul>
  </article>
</main>
<aside>Related: ten things you won't believe about energy and your wallet.</aside>
<footer>© 2026 Example Corp. All rights reserved. Terms Privacy</footer>
<!-- tracking comment -->
</body></html>`;

describe("extractReadable", () => {
  const { title, text } = extractReadable(page);

  it("reads the title with entities decoded", () => {
    expect(title).toBe("Solar & wind: a primer");
  });

  it("keeps the article text, as separate paragraphs", () => {
    expect(text).toContain("Solar power is getting cheaper");
    expect(text).toContain("fallen by roughly ninety percent");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(4);
    expect(text).toContain("Batteries smooth out the daily peak.");
  });

  it("drops scripts, styles, menus, forms, side content, footers, and comments", () => {
    for (const unwanted of ["steal cookies", "color:red", "Home", "About", "Subscribe", "Email", "Related:", "Corp", "tracking comment"]) {
      expect(text, unwanted).not.toContain(unwanted);
    }
  });

  it("falls back to the whole body when there is no article, and handles junk", () => {
    expect(extractReadable("<body><p>Just a paragraph that is long enough to be kept as content here.</p></body>").text).toContain("Just a paragraph");
    expect(extractReadable("not html at all").text).toBe("not html at all");
    expect(extractReadable("").text).toBe("");
  });

  it("caps how much text is returned", () => {
    const long = `<p>${"word ".repeat(10_000)}</p>`;
    expect(extractReadable(long, 500).text.length).toBeLessThanOrEqual(501);
  });

  it("never lets markup through", () => {
    const sneaky = extractReadable(`<main><p>Hello <img src=x onerror=alert(1)> <b>world</b>, this sentence is long enough to be kept.</p><script>evil()</script></main>`);
    expect(sneaky.text).not.toMatch(/[<>]/);
    expect(sneaky.text).toContain("Hello  world, this sentence".replace("  ", " ").slice(0, 6));
  });
});
