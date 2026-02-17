/**
 * Browser profile persistence — async SQL-backed via Storage API.
 *
 * Re-exports repository functions and provides loadProfile/saveProfile
 * for backwards-compatible use in browser.ts.
 */

export {
  type BrowserProfile,
  initBrowserProfileStorage,
  listProfileNames as listProfiles,
  loadProfile,
  saveProfile,
} from "../browser-profile-repository.js";
