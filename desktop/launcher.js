// Starts the OMNI server and makes sure it stops when the desktop app does, even if the app is force-quit or crashes.
const parent = Number(process.env.OMNI_PARENT_PID);
if (parent) {
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (error) {
      if (error.code !== "EPERM") process.exit(0);
    }
  }, 2000);
}
require("./server.js");
