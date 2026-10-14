// electron-builder leaves out any top-level node_modules folder from extra resources, and the OMNI server needs its own.
// Copy it into the packaged app after packing, before the installer is made.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const from = path.join(__dirname, "server-bundle", "node_modules");
  const to = path.join(resources, "app-server", "node_modules");
  if (!fs.existsSync(from)) throw new Error("Run `node prepare.mjs` first: server-bundle/node_modules is missing.");
  fs.cpSync(from, to, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(to, "next"))) throw new Error("The server's modules were not copied into the app.");
};
