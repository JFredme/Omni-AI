import PptxGenJS from "pptxgenjs";
import { plainInline } from "./markdown";
import type { DeckModel } from "./model";

/** A clean deck: a title slide, then one slide per entry with its points as bullets, and speaker notes where given. */
export async function renderPptx(deck: DeckModel): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches
  pres.title = deck.title;
  pres.author = "Omni";
  const INK = "2A2723";
  const GREEN = "1A5A40";
  const BACKGROUND = "FBF9F4";

  const opening = pres.addSlide();
  opening.background = { color: BACKGROUND };
  opening.addShape("rect", { x: 0.8, y: 3.55, w: 1.6, h: 0.06, fill: { color: GREEN } });
  opening.addText(plainInline(deck.title), { x: 0.8, y: 1.6, w: 11.7, h: 1.8, fontFace: "Georgia", fontSize: 40, bold: true, color: INK, valign: "bottom" });

  for (const slide of deck.slides) {
    const s = pres.addSlide();
    s.background = { color: BACKGROUND };
    s.addText(plainInline(slide.title), { x: 0.8, y: 0.5, w: 11.7, h: 1.0, fontFace: "Georgia", fontSize: 30, bold: true, color: INK, valign: "middle" });
    s.addShape("rect", { x: 0.8, y: 1.55, w: 1.2, h: 0.05, fill: { color: GREEN } });
    if (slide.bullets.length) {
      s.addText(
        slide.bullets.map((bullet) => ({ text: plainInline(bullet), options: { bullet: true, breakLine: true, paraSpaceAfter: 10 } })),
        { x: 0.8, y: 1.9, w: 11.7, h: 5.0, fontFace: "Calibri", fontSize: 20, color: INK, valign: "top" },
      );
    }
    if (slide.notes) s.addNotes(slide.notes);
  }
  const out = (await pres.write({ outputType: "nodebuffer" })) as Buffer | Uint8Array | ArrayBuffer;
  return out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as Uint8Array);
}
