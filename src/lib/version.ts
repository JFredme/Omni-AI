/** The app's version, set at build time from package.json (see next.config.ts). */
export const APP_VERSION = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}`;

/** Which build this is: the Mac or Windows desktop app, or the plain web app. Set by the desktop app's launcher. */
export const APP_FLAVOR = process.env.NEXT_PUBLIC_APP_FLAVOR ?? "web";
