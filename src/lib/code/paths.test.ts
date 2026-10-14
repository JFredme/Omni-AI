import { describe, expect, it } from "vitest";
import { buildTree, extensionOf, languageFor, pathProblem } from "./paths";

describe("pathProblem", () => {
  it("accepts ordinary relative paths", () => {
    for (const path of ["main.py", "src/app.js", "a/b/c/d.txt", "notes_v2-final.md", ".gitignore", "src/.env.example"]) expect(pathProblem(path), path).toBeNull();
  });

  it("refuses anything that could climb out of the project or confuse a shell", () => {
    for (const path of ["", "/etc/passwd", "../secret", "a/../../b", "a//b", "a/./b", "dir/", "a b.txt", "semi;colon.js", "back\\slash.js", "dollar$.js", "back`tick.js", "quote'.js", "new\nline.js", "uni‮code.js", "a/b/c/d/e/f/g.txt", "x".repeat(200)]) {
      expect(pathProblem(path), JSON.stringify(path)).not.toBeNull();
    }
  });
});

describe("languages", () => {
  it("maps extensions to editor languages and says which can run", () => {
    expect(extensionOf("src/Main.PY")).toBe("py");
    expect(languageFor("a.py")).toMatchObject({ monaco: "python", run: "python" });
    expect(languageFor("a.mjs")).toMatchObject({ monaco: "javascript", run: "node" });
    expect(languageFor("a.ts").run).toBeNull();
    expect(languageFor("Makefile")).toMatchObject({ monaco: "plaintext", run: null });
  });
});

describe("buildTree", () => {
  it("nests folders, puts folders before files, and sorts by name", () => {
    const file = (path: string) => ({ id: path, path, size: 1, updatedAt: "" });
    const tree = buildTree([file("z.txt"), file("src/b.js"), file("src/a.js"), file("README.md"), file("src/lib/x.js")]);
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md", "z.txt"]);
    expect(tree[0].children.map((n) => n.name)).toEqual(["lib", "a.js", "b.js"]);
    expect(tree[0].children[0].children[0].path).toBe("src/lib/x.js");
  });
});
