/**
 * Browser profile persistence — async SQL-backed via Storage API.
 *
 * Re-exports repository functions and provides loadProfile/saveProfile
 * for backwards-compatible use in browser.ts.
 */

export { initBrowserProfileStorage } from "../browser-profile-repository.js";
export { listProfileNames as listProfiles } from "../browser-profile-repository.js";
export { loadProfile, saveProfile, type BrowserProfile } from "../browser-profile-repository.js";
