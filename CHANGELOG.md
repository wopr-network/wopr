# Changelog

All notable changes to WOPR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Migration Notes

### Cron Scheduling Extracted to Plugin (WOP-1771)

The built-in cron scheduling support has been **removed from the WOPR core** and
extracted to the standalone `wopr-plugin-cron` package.

**What was removed:**

- `CronJob` and `CronScript` types from core
- `getCrons()`, `addCron()`, `removeCron()` from core API
- `cronScriptsEnabled` config field (now ignored)

**Upgrade steps:**

```bash
npm install wopr-plugin-cron
```

Then register the plugin in your WOPR config:

```json
{
  "plugins": ["wopr-plugin-cron"]
}
```

If you do not install `wopr-plugin-cron`, any cron-related API calls will fail.

---

### `http_fetch` and `exec_command` Extracted to Plugin (WOP-567)

The built-in `http_fetch` and `exec_command` tools have been **removed from the WOPR core** and
extracted to the standalone [`@wopr-network/plugin-tools`](https://github.com/wopr-network/wopr-plugin-tools) package.

**Upgrade steps:**

```bash
npm install @wopr-network/plugin-tools
```

Then register the plugin in your WOPR config:

```json
{
  "plugins": ["@wopr-network/plugin-tools"]
}
```

If you do not install `@wopr-network/plugin-tools`, any agent tool calls to `http_fetch` or
`exec_command` will fail with an unknown-tool error.

See the [plugin-tools README](https://github.com/wopr-network/wopr-plugin-tools#readme) for full
documentation and configuration options.

---

## [2.0.3](https://github.com/wopr-network/wopr/compare/wopr-v2.0.2...wopr-v2.0.3) (2026-03-13)


### Bug Fixes

* inline dependabot auto-merge workflow ([#2604](https://github.com/wopr-network/wopr/issues/2604)) ([dcec423](https://github.com/wopr-network/wopr/commit/dcec423307529d3ab0515bd330b4988ca89dfc76))
* major-version detection in dependabot auto-merge ([#2605](https://github.com/wopr-network/wopr/issues/2605)) ([2ea2674](https://github.com/wopr-network/wopr/commit/2ea2674300f626cd40bf103261eeb76925259be7))
* use pull_request_target for dependabot auto-merge ([#2602](https://github.com/wopr-network/wopr/issues/2602)) ([0c082aa](https://github.com/wopr-network/wopr/commit/0c082aa559cc8b89e4310ad2c216ba6fa819fd36))

## [2.0.2](https://github.com/wopr-network/wopr/compare/wopr-v2.0.1...wopr-v2.0.2) (2026-03-11)


### Tests

* add ticket-based WebSocket auth tests (WOP-2095) ([#2548](https://github.com/wopr-network/wopr/issues/2548)) ([8d69cfc](https://github.com/wopr-network/wopr/commit/8d69cfc6aea3193be6f4ca27fc622c3a15a111df))


### Documentation

* prefer jj over git for VCS operations ([#2547](https://github.com/wopr-network/wopr/issues/2547)) ([4169a4a](https://github.com/wopr-network/wopr/commit/4169a4aef06534336599c5802530bd6de37fc97f))


### Miscellaneous

* **deps:** bump hono in the npm_and_yarn group across 1 directory ([#2545](https://github.com/wopr-network/wopr/issues/2545)) ([09f7840](https://github.com/wopr-network/wopr/commit/09f7840404d74356c7363179a7e7256a985b502f))

## [2.0.1](https://github.com/wopr-network/wopr/compare/wopr-v2.0.0...wopr-v2.0.1) (2026-03-09)


### Tests

* fix flaky hook timeouts in capability-activation and plugin-config-validation tests ([#2406](https://github.com/wopr-network/wopr/issues/2406)) ([3ff0a4e](https://github.com/wopr-network/wopr/commit/3ff0a4e79e27b393cb0d0efcfbdc72e358593c68))


### Miscellaneous

* **ci:** bump docker/build-push-action from 6 to 7 ([#2395](https://github.com/wopr-network/wopr/issues/2395)) ([ad06247](https://github.com/wopr-network/wopr/commit/ad0624723c0b8373160f34bf391a91c117509789))
* **ci:** bump docker/login-action from 3 to 4 ([#2394](https://github.com/wopr-network/wopr/issues/2394)) ([41e05ff](https://github.com/wopr-network/wopr/commit/41e05ff49071e429258665db18b46ec48decdd43))
* **ci:** bump docker/setup-qemu-action from 3 to 4 ([#2396](https://github.com/wopr-network/wopr/issues/2396)) ([bc6e96b](https://github.com/wopr-network/wopr/commit/bc6e96b17c38d0bbccee0bd440275948d4b827b5))
* **deps:** bump @anthropic-ai/claude-agent-sdk from 0.2.63 to 0.2.71 ([#2401](https://github.com/wopr-network/wopr/issues/2401)) ([4d30aab](https://github.com/wopr-network/wopr/commit/4d30aab7a78aac5036c5ed50e514e7e9acf6944e))
* **deps:** bump @clack/prompts from 1.0.1 to 1.1.0 ([#2397](https://github.com/wopr-network/wopr/issues/2397)) ([5ae19e9](https://github.com/wopr-network/wopr/commit/5ae19e9a097124e829753922e21744d42baf4681))
* **deps:** bump @hono/node-server from 1.19.10 to 1.19.11 ([#2399](https://github.com/wopr-network/wopr/issues/2399)) ([321dfea](https://github.com/wopr-network/wopr/commit/321dfea004476efb18ad08fac3851ce76e9eeed8))
* **deps:** bump @types/node from 25.3.3 to 25.3.5 ([#2400](https://github.com/wopr-network/wopr/issues/2400)) ([5bc6b3c](https://github.com/wopr-network/wopr/commit/5bc6b3c0f055cc24029ede6081a2b5aff2bf37a1))
* **deps:** bump hono from 4.12.4 to 4.12.5 ([#2398](https://github.com/wopr-network/wopr/issues/2398)) ([7a01a40](https://github.com/wopr-network/wopr/commit/7a01a40fc6af08b4929332b81f1bdd02b7cb7048))

## [2.0.0](https://github.com/wopr-network/wopr/compare/wopr-v1.6.0...wopr-v2.0.0) (2026-03-07)


### ⚠ BREAKING CHANGES

* CronJob, CronScript, CronScriptResult, CronHistoryEntry types removed from public API. cronScriptsEnabled config field removed. WoprClient.getCrons/addCron/removeCron removed. createCronContext removed. cron.manage permission, cron injection source, and cron_* tool capabilities removed from core seeds. Cron plugin must register its own types, permissions, and security metadata via WOPRPluginContext.

### Features

* dynamic permission, source, and tool-mapping registration (WOP-1770) ([#2146](https://github.com/wopr-network/wopr/issues/2146)) ([bbdbe4d](https://github.com/wopr-network/wopr/commit/bbdbe4d76eafd7f2e89a2b186c0e1352f79aaeef))


### Bug Fixes

* clear timer leak in withIdleTimeout (WOP-1713) ([#2135](https://github.com/wopr-network/wopr/issues/2135)) ([bec3b2c](https://github.com/wopr-network/wopr/commit/bec3b2ccd9882c6a7bd923a203f7b9114d1ac408))
* make capability catalog URL configurable via env var (WOP-1603) ([#1947](https://github.com/wopr-network/wopr/issues/1947)) ([2baf158](https://github.com/wopr-network/wopr/commit/2baf158cff9036c30b5b6a6f966a2974edec174a))
* make OAuth authorize URL configurable via WOPR_OAUTH_AUTH_URL (WOP-1571) ([#2032](https://github.com/wopr-network/wopr/issues/2032)) ([48fdb88](https://github.com/wopr-network/wopr/commit/48fdb88deca2263a8fd56780b13646a4c0fabefb))


### Code Refactoring

* dynamic event type registration via EventTypeRegistry (WOP-1776) ([#2153](https://github.com/wopr-network/wopr/issues/2153)) ([e98ae80](https://github.com/wopr-network/wopr/commit/e98ae80bed66b05ce5fe7c8bd59017b9c3e9aea4))
* extract http_fetch and exec_command from core — network and shell are plugins (WOP-2144) ([#2147](https://github.com/wopr-network/wopr/issues/2147)) ([c318e09](https://github.com/wopr-network/wopr/commit/c318e096884070ecd616f1191b6c07dc10b339be))
* extract http_fetch and exec_command from core (WOP-1777) ([#2149](https://github.com/wopr-network/wopr/issues/2149)) ([0034a0b](https://github.com/wopr-network/wopr/commit/0034a0b8a42f85f985fb3ee070ac2c2a51436897))
* remove all cron code from wopr core (WOP-1771) ([#2150](https://github.com/wopr-network/wopr/issues/2150)) ([24efef1](https://github.com/wopr-network/wopr/commit/24efef19cab15d06ec0fab9e50a38cd149ac921e))
* remove all memory code from wopr core — memory is a plugin (WOP-1773) ([#2151](https://github.com/wopr-network/wopr/issues/2151)) ([4bbfb60](https://github.com/wopr-network/wopr/commit/4bbfb60ddbd1ab41823c63f00fd3fe3e349c6f57))
* remove all memory functionality from wopr core (WOP-1726) ([#2290](https://github.com/wopr-network/wopr/issues/2290)) ([0e9fbcb](https://github.com/wopr-network/wopr/commit/0e9fbcb3a95011fed74ad96782ff52d3d4dff54c))
* remove all skills code from wopr core (WOP-1775) ([#2152](https://github.com/wopr-network/wopr/issues/2152)) ([8f22e8a](https://github.com/wopr-network/wopr/commit/8f22e8ab8392834a407c2a4a39ae89f21b414cd6))


### Security

* add requireAdmin() to mutating plugin routes (WOP-1710) ([#2090](https://github.com/wopr-network/wopr/issues/2090)) ([2ee4faf](https://github.com/wopr-network/wopr/commit/2ee4faf2a4560a6b27e9a746435bd7521c2d97d0))
* add requireAuth() to plugin-mounted routes (WOP-1546) ([#1945](https://github.com/wopr-network/wopr/issues/1945)) ([0a87b20](https://github.com/wopr-network/wopr/commit/0a87b20ca37b0190e9a1f56c8c78b1bfd6c5fb24))
* add requireWriteScope() middleware for all mutating routes (WOP-1711) ([#2123](https://github.com/wopr-network/wopr/issues/2123)) ([967863c](https://github.com/wopr-network/wopr/commit/967863c79cb54e906f332041ff1349a5cb0f6dee))
* add write-scope guard to config PUT/DELETE routes (WOP-1709) ([#2088](https://github.com/wopr-network/wopr/issues/2088)) ([ccf69f9](https://github.com/wopr-network/wopr/commit/ccf69f95ed508339aad9169ae805dd12c1ebf778))
* enforce API key scope on WebSocket topic subscriptions (WOP-1712) ([#2136](https://github.com/wopr-network/wopr/issues/2136)) ([757261a](https://github.com/wopr-network/wopr/commit/757261adeef588a0d983ca7ceb98d6e7dbc1afc2))
* gate /openapi.json and /healthz/history behind auth (WOP-1550) ([#2039](https://github.com/wopr-network/wopr/issues/2039)) ([0e151ff](https://github.com/wopr-network/wopr/commit/0e151ff0e3fb81dd4859e02b7dde1dd8171f9d9f))
* guard setValue/getValue and config routes against prototype pollution (WOP-1539) ([#1942](https://github.com/wopr-network/wopr/issues/1942)) ([58b06a9](https://github.com/wopr-network/wopr/commit/58b06a9a696e7eaf1d338dc80d44f997c21ed02f))
* validate docker image names to prevent registry injection (WOP-1545) ([#1943](https://github.com/wopr-network/wopr/issues/1943)) ([4fdd1e4](https://github.com/wopr-network/wopr/commit/4fdd1e48e36ed7320b305f17891b2200dc9a6f59))


### Tests

* add afterEach restoreAllMocks to 4 test files (WOP-1586) ([#2030](https://github.com/wopr-network/wopr/issues/2030)) ([8c9eef5](https://github.com/wopr-network/wopr/commit/8c9eef54c19eb993810ce077623ad30de902478f))
* add comprehensive tests for RateLimitTracker (WOP-1573) ([#2010](https://github.com/wopr-network/wopr/issues/2010)) ([3314fab](https://github.com/wopr-network/wopr/commit/3314fabc91142969066181b37625e440195e7072))
* add daemon auth middleware tests (WOP-1572) ([#2011](https://github.com/wopr-network/wopr/issues/2011)) ([4ad32f4](https://github.com/wopr-network/wopr/commit/4ad32f46056bbd453faa004a7fa4aa1dd4f5697a))
* add onboarding step test coverage for 8 steps (WOP-1584) ([#2034](https://github.com/wopr-network/wopr/issues/2034)) ([23a2f2f](https://github.com/wopr-network/wopr/commit/23a2f2f8219b7bde370ede7205ecf80de9000576))
* add session-schema validation tests (WOP-1596) ([#2038](https://github.com/wopr-network/wopr/issues/2038)) ([78576f3](https://github.com/wopr-network/wopr/commit/78576f35cc17b93d52f126373a52b9961d63b002))
* add unit tests for tryPluginCommand (WOP-1595) ([#2036](https://github.com/wopr-network/wopr/issues/2036)) ([ae60a38](https://github.com/wopr-network/wopr/commit/ae60a38632c7787a73ff10566ecc8e125e5503a7))
* prevent start/stop interval tests from hanging due to background cleanup race ([#2008](https://github.com/wopr-network/wopr/issues/2008)) ([b7b1a0c](https://github.com/wopr-network/wopr/commit/b7b1a0c1fbc521ffd5e86753bb9ea4e4326d5032))
* replace toBeDefined() with exact value assertions in temporal filter tests (WOP-1597) ([#2040](https://github.com/wopr-network/wopr/issues/2040)) ([ce26c5d](https://github.com/wopr-network/wopr/commit/ce26c5d35348725f7068ff38fb4612b7d5a8d731))
* **security:** strengthen weak assertions with specific value checks (WOP-1587) ([#2031](https://github.com/wopr-network/wopr/issues/2031)) ([41cdc9f](https://github.com/wopr-network/wopr/commit/41cdc9f9b598981ad94c186303cb816debcdece5))


### Miscellaneous

* **deps:** bump @hono/node-server from 1.19.9 to 1.19.10 ([#2042](https://github.com/wopr-network/wopr/issues/2042)) ([3946510](https://github.com/wopr-network/wopr/commit/3946510f116c1b47b104a8371baf4723208e026f))
* **deps:** bump hono from 4.12.3 to 4.12.4 ([#2043](https://github.com/wopr-network/wopr/issues/2043)) ([5ddc14f](https://github.com/wopr-network/wopr/commit/5ddc14fabfa83cb68ac2da5cfe39e089c173ffba))

## [1.6.0](https://github.com/wopr-network/wopr/compare/wopr-v1.5.0...wopr-v1.6.0) (2026-03-04)


### Features

* add --config &lt;path&gt; global flag to CLI (WOP-1501) ([#1842](https://github.com/wopr-network/wopr/issues/1842)) ([63aab76](https://github.com/wopr-network/wopr/commit/63aab76b8619271a614aafe6a2e4753cec746b58))
* add non-LLM capability routing endpoints (WOP-1509) ([#1811](https://github.com/wopr-network/wopr/issues/1811)) ([799f9df](https://github.com/wopr-network/wopr/commit/799f9df9cca50718f4ef7af02be4103fc4ebbbdf))
* add optional streaming interface for A2A tool handlers (WOP-1507) ([#1852](https://github.com/wopr-network/wopr/issues/1852)) ([cfe4618](https://github.com/wopr-network/wopr/commit/cfe4618c46da4ae6b491580b3f85327441001e66))
* add session TTL expiry, periodic cleanup, and LRU eviction (WOP-1505) ([#1808](https://github.com/wopr-network/wopr/issues/1808)) ([1d07f21](https://github.com/wopr-network/wopr/commit/1d07f2105cdc93f37d2f554c579798bf4af6d68b))
* add SIGHUP config hot-reload to daemon (WOP-1502) ([#1849](https://github.com/wopr-network/wopr/issues/1849)) ([bd3402f](https://github.com/wopr-network/wopr/commit/bd3402f22a92fdff3dfd49606bc8120508a81d39))
* add src/index.ts barrel export and package.json exports map (WOP-1381) ([#1652](https://github.com/wopr-network/wopr/issues/1652)) ([227e640](https://github.com/wopr-network/wopr/commit/227e6404a2adf632544a6f1baa97fbcd43042d0c))
* add WOPR marketing bot config and content strategy skill (WOP-1253) ([#1482](https://github.com/wopr-network/wopr/issues/1482)) ([3e568b7](https://github.com/wopr-network/wopr/commit/3e568b7af28f2624a571bc78cd4df2d947ffbf44))
* add wopr status command (WOP-1474) ([#1820](https://github.com/wopr-network/wopr/issues/1820)) ([6ccb8b3](https://github.com/wopr-network/wopr/commit/6ccb8b366027bbcec9c42a048c7d2328ead865b5))
* **core:** implement unregisterSetupContextProvider in context-factory (WOP-1017) ([#1351](https://github.com/wopr-network/wopr/issues/1351)) ([83bd630](https://github.com/wopr-network/wopr/commit/83bd6308b061ab7633b862178910cff7fa2cb7b2))
* emit provider:added/removed/status events from ProviderRegistry (WOP-1508) ([#1812](https://github.com/wopr-network/wopr/issues/1812)) ([f50d98b](https://github.com/wopr-network/wopr/commit/f50d98b5ce99bcb11549217db9ca4c61daeb8e93))
* enforce plugin requires[] on marketplace install (WOP-1461) ([#1814](https://github.com/wopr-network/wopr/issues/1814)) ([0c36841](https://github.com/wopr-network/wopr/commit/0c36841b4192b60c550e83ff3247f01596832c26))
* expose session.getContext/setContext/readConversationLog as ctx extensions (WOP-1538) ([#1857](https://github.com/wopr-network/wopr/issues/1857)) ([b9b10b3](https://github.com/wopr-network/wopr/commit/b9b10b3fd9caad53eeed09f16767970d755d89d7))
* implement pluggable inference routing strategies (WOP-1476) ([#1830](https://github.com/wopr-network/wopr/issues/1830)) ([850d6b4](https://github.com/wopr-network/wopr/commit/850d6b4bd9ee615912854d45251bb07d740711fd))
* per-provider rate limiting with exponential backoff (WOP-1475) ([#1838](https://github.com/wopr-network/wopr/issues/1838)) ([78dbdc2](https://github.com/wopr-network/wopr/commit/78dbdc21bc4ab477fe2e4d6c6df3c3f5d189cdc4))
* per-provider rate limiting with exponential backoff (WOP-1475) ([#1938](https://github.com/wopr-network/wopr/issues/1938)) ([1ac57cf](https://github.com/wopr-network/wopr/commit/1ac57cfe259a8e04be3c5dd9a0054e8062f938a3))
* plugin circuit breaker to prevent misbehaving plugins crashing daemon (WOP-1471) ([#1818](https://github.com/wopr-network/wopr/issues/1818)) ([fc65d77](https://github.com/wopr-network/wopr/commit/fc65d776845dcf39f0456b78c2acdc900d2fc8c5))
* plugin-to-plugin A2A tool dependency auto-connection (WOP-1469) ([#1816](https://github.com/wopr-network/wopr/issues/1816)) ([e7d0fc9](https://github.com/wopr-network/wopr/commit/e7d0fc9ee38b9e3816b9feee24828c7f26e99b52))
* probe plugin healthCheck() in daemon health monitor (WOP-1470) ([#1822](https://github.com/wopr-network/wopr/issues/1822)) ([fcb28d4](https://github.com/wopr-network/wopr/commit/fcb28d45ebefd643fc329283e6037194fb00978c))
* read WOPR_PLUGINS_* env vars at daemon startup to auto-install plugins (WOP-1327) ([#1559](https://github.com/wopr-network/wopr/issues/1559)) ([676068e](https://github.com/wopr-network/wopr/commit/676068e54fc2628be2c2650c437092609d7bc239))
* scope-aware injection trust for /inject and /v1/chat endpoints (WOP-1422) ([#1721](https://github.com/wopr-network/wopr/issues/1721)) ([3b1730d](https://github.com/wopr-network/wopr/commit/3b1730d59918ea920e8d30b710755aeef1b20bd6))
* token-aware context window management (WOP-1477) ([#1819](https://github.com/wopr-network/wopr/issues/1819)) ([1bf57d6](https://github.com/wopr-network/wopr/commit/1bf57d61c7c914f9232e8c66724c0933d48bec4d))
* warn at startup when plugin sandboxing is disabled (WOP-1510) ([#1809](https://github.com/wopr-network/wopr/issues/1809)) ([e2230dc](https://github.com/wopr-network/wopr/commit/e2230dc126dc1f3f2fae647900c85d3e941c790d))
* wopr doctor command (WOP-1503) ([#1839](https://github.com/wopr-network/wopr/issues/1839)) ([5370217](https://github.com/wopr-network/wopr/commit/53702172991029b20ea6655b5375a4786c1f67dd))


### Bug Fixes

* add error boundary to plugin init() with cleanup on failure (WOP-1466) ([#1826](https://github.com/wopr-network/wopr/issues/1826)) ([e36bd0f](https://github.com/wopr-network/wopr/commit/e36bd0fc90a2429b66ec42f0664fcc69327c842f))
* add permissions and setup fields to Zod manifest schema (WOP-1464) ([#1829](https://github.com/wopr-network/wopr/issues/1829)) ([22a28e9](https://github.com/wopr-network/wopr/commit/22a28e90aaf9d4b5389f49307488ccd36eb0b122))
* add Zod runtime validation to WoprConfig (WOP-1412) ([#1799](https://github.com/wopr-network/wopr/issues/1799)) ([7c9d574](https://github.com/wopr-network/wopr/commit/7c9d5748082e9b42636c9ba1459d17e833893dcf))
* address review feedback on session-cleaner (WOP-1505) ([#1810](https://github.com/wopr-network/wopr/issues/1810)) ([6cf3d39](https://github.com/wopr-network/wopr/commit/6cf3d3924228b885ba403df404908b527b4d7ea3))
* allow better-sqlite3 native build in pnpm install ([#1833](https://github.com/wopr-network/wopr/issues/1833)) ([bc2d93f](https://github.com/wopr-network/wopr/commit/bc2d93f9eaf1a8ecb11ae3add3717e554d1ba900))
* always log in to GHCR so PR builds can pull private base image ([#1847](https://github.com/wopr-network/wopr/issues/1847)) ([9f689e5](https://github.com/wopr-network/wopr/commit/9f689e5a8819efb0bdff30040b29f7df784c8299))
* await handler result before streaming check, fix isAsyncIterable guard, fix A2AToolResult passthrough (WOP-1507) ([#1859](https://github.com/wopr-network/wopr/issues/1859)) ([6a743c7](https://github.com/wopr-network/wopr/commit/6a743c777eabbd1bc956cbefef8b3643b753e633))
* clean up connectionTimestamps on session:destroy (WOP-1387) ([#1650](https://github.com/wopr-network/wopr/issues/1650)) ([d50f560](https://github.com/wopr-network/wopr/commit/d50f5607d6b15b343d6b753af0e60985b49b6c03))
* clear timeout timer and guard stdin errors in runCommandHook (WOP-1378) ([#1640](https://github.com/wopr-network/wopr/issues/1640)) ([34827bc](https://github.com/wopr-network/wopr/commit/34827bc6ae8f6420fc67246397d1626c8a8300a7))
* clear timeout timers in Promise.race patterns to prevent leaks (WOP-1438) ([#1834](https://github.com/wopr-network/wopr/issues/1834)) ([a346de0](https://github.com/wopr-network/wopr/commit/a346de09d493a6423bb6853a9f90ea0cf56e8de7))
* clear timeout timers in Promise.race patterns to prevent leaks (WOP-1438) ([#1925](https://github.com/wopr-network/wopr/issues/1925)) ([1353d57](https://github.com/wopr-network/wopr/commit/1353d57681c9f61a0586721365084e9f5ff546e2))
* config flag and paths mock (WOP-1501) ([#1939](https://github.com/wopr-network/wopr/issues/1939)) ([ab5f602](https://github.com/wopr-network/wopr/commit/ab5f60216680dcd7e520823e2f8e132c06b2da98))
* config hot reload (WOP-1502) ([#1932](https://github.com/wopr-network/wopr/issues/1932)) ([39b3502](https://github.com/wopr-network/wopr/commit/39b35021a60cb3fa6651dfd4700de2ea487c90d2))
* daemon crashes on uncaught exceptions instead of swallowing them (WOP-1411) ([#1714](https://github.com/wopr-network/wopr/issues/1714)) ([708945a](https://github.com/wopr-network/wopr/commit/708945ab1ae4c7e09d98312a0fc4b5fb7a61074d))
* define concrete InjectionSource type for PluginInjectOptions.source (WOP-1498) ([#1848](https://github.com/wopr-network/wopr/issues/1848)) ([11a2cc3](https://github.com/wopr-network/wopr/commit/11a2cc3b526ea0498645071ff736a683facb45e9))
* doctor auth check, align plugin check with loader (WOP-1503) ([#1933](https://github.com/wopr-network/wopr/issues/1933)) ([2ff1c4a](https://github.com/wopr-network/wopr/commit/2ff1c4a221e4b89e9805a2f5e57cdc7bd92352a6))
* document missing env vars in .env.example (WOP-1504) ([#1832](https://github.com/wopr-network/wopr/issues/1832)) ([2e5c3bf](https://github.com/wopr-network/wopr/commit/2e5c3bf888cbcc6d9cf4d0186ffa51c0af047c6b))
* eliminate TOCTOU race in transaction() with promise-based lock (WOP-1380) ([#1653](https://github.com/wopr-network/wopr/issues/1653)) ([d710bba](https://github.com/wopr-network/wopr/commit/d710bbafb977f39663e8cb87b01fb302cb8da9cd))
* emit zero usage in streaming final chunk when provider omits usage (WOP-1478) ([#1815](https://github.com/wopr-network/wopr/issues/1815)) ([177fb67](https://github.com/wopr-network/wopr/commit/177fb670f7957bb984d9376ec4632df8511bb644))
* export SetupContextProvider from plugin-types index (WOP-1500) ([#1831](https://github.com/wopr-network/wopr/issues/1831)) ([60784ac](https://github.com/wopr-network/wopr/commit/60784acce8a6f744074796bd4b64ad47db3b83fa))
* gate stack traces on shouldLogStack() in production (WOP-1433) ([#1723](https://github.com/wopr-network/wopr/issues/1723)) ([9dcbff4](https://github.com/wopr-network/wopr/commit/9dcbff4fe37c7f02ca129c4f31270db4c62b00a6))
* guard SSE writes with aborted flag after client disconnect (WOP-1439) ([#1841](https://github.com/wopr-network/wopr/issues/1841)) ([e8753fc](https://github.com/wopr-network/wopr/commit/e8753fce690a7aad32658e97657467c0c5845b36))
* log selfdoc dynamic import errors instead of swallowing (WOP-1390) ([#1647](https://github.com/wopr-network/wopr/issues/1647)) ([21cad15](https://github.com/wopr-network/wopr/commit/21cad1511e223a99cea5b472bb0e82fff39a9a46))
* make OAuth token URL configurable via WOPR_OAUTH_TOKEN_URL env var (WOP-1403) ([#1646](https://github.com/wopr-network/wopr/issues/1646)) ([b6d243b](https://github.com/wopr-network/wopr/commit/b6d243b67fef9a2830636e77d9c26a541029b1e0))
* namespace A2A tool keys by pluginId to prevent silent overwrites (WOP-1467) ([#1824](https://github.com/wopr-network/wopr/issues/1824)) ([f2d3c51](https://github.com/wopr-network/wopr/commit/f2d3c51520edbc699b81bc38fd0e7e0483b5c803))
* node:sqlite import error handling, encoder init race condition (WOP-1435) ([#1928](https://github.com/wopr-network/wopr/issues/1928)) ([d883d6d](https://github.com/wopr-network/wopr/commit/d883d6d4a1b793aa4594d60116e973943502bc99))
* notify running daemon on config set/reset (WOP-1473) ([#1821](https://github.com/wopr-network/wopr/issues/1821)) ([9d0c6cf](https://github.com/wopr-network/wopr/commit/9d0c6cf58aa7e91d1f43b4c252e6b15adb180f04))
* read capability catalog baseUrl from WOPR_API_BASE_URL env var (WOP-1434) ([#1722](https://github.com/wopr-network/wopr/issues/1722)) ([5bbf251](https://github.com/wopr-network/wopr/commit/5bbf251f855cdec6431082ea7683e257c94f51a1))
* redact auth token from logs (WOP-1442) ([#1930](https://github.com/wopr-network/wopr/issues/1930)) ([14f1049](https://github.com/wopr-network/wopr/commit/14f1049b8139f8475b995403dfaae88f294e3705))
* remove greptile-apps[bot] trigger from auto-fix workflow ([babe5b0](https://github.com/wopr-network/wopr/commit/babe5b06236420f677216cfc6e59d5dab5c85347))
* remove memory module / fix temporal filter (WOP-1506) ([#1934](https://github.com/wopr-network/wopr/issues/1934)) ([5aa437e](https://github.com/wopr-network/wopr/commit/5aa437eba0acb7941395fe592c8d8b4e4546a6d3))
* remove optional markers from registerA2AServer/unregisterA2AServer (WOP-1468) ([#1828](https://github.com/wopr-network/wopr/issues/1828)) ([e3416dd](https://github.com/wopr-network/wopr/commit/e3416dd191c54555f144b31134d710c7bf5b9bac))
* replace unknown with ModelProvider type on registerLLMProvider (WOP-1465) ([#1825](https://github.com/wopr-network/wopr/issues/1825)) ([5c328bf](https://github.com/wopr-network/wopr/commit/5c328bf4107fc838fac083a1a8d5b8073d9a9656))
* return real token usage from OpenAI-compatible endpoint (WOP-1459) ([#1807](https://github.com/wopr-network/wopr/issues/1807)) ([91d11bc](https://github.com/wopr-network/wopr/commit/91d11bce8c3b544f759f7544d402e1dfb98dcf33))
* **security:** redact auth token from onboarding logs (WOP-1442) ([#1844](https://github.com/wopr-network/wopr/issues/1844)) ([83c8ad5](https://github.com/wopr-network/wopr/commit/83c8ad5a8898e5a37d34bb832772618c276c537a))
* serialize concurrent plugin installs to prevent TOCTOU race (WOP-1440) ([#1846](https://github.com/wopr-network/wopr/issues/1846)) ([e51ce52](https://github.com/wopr-network/wopr/commit/e51ce52f8104e088a15a229a0ef3a1ee775d6383))
* suppress late healthCheck rejection after timeout in runProbeWithTimeout (WOP-1533) ([#1827](https://github.com/wopr-network/wopr/issues/1827)) ([659ab1d](https://github.com/wopr-network/wopr/commit/659ab1d8beff294891097c1e2048f40517b37ab4))
* surface non-ENOENT errors in session context filesystem migration (WOP-1441) ([#1845](https://github.com/wopr-network/wopr/issues/1845)) ([0b5bcdf](https://github.com/wopr-network/wopr/commit/0b5bcdf9a580fad871514b1ea741660df4e60885))
* tighten A2AToolResult guard and fix streaming bug (WOP-1507) ([#1935](https://github.com/wopr-network/wopr/issues/1935)) ([307f471](https://github.com/wopr-network/wopr/commit/307f47127e3f8d5f99a74e34a72a3f3bc4cf4970))
* TOCTOU lock race condition (WOP-1440) ([#1929](https://github.com/wopr-network/wopr/issues/1929)) ([3d43785](https://github.com/wopr-network/wopr/commit/3d43785bcbcbfcb19f417b7f72bb4aedc6f6fa0c))
* use setSessionProviderAsync instead of writing .provider.json (WOP-1534) ([#1936](https://github.com/wopr-network/wopr/issues/1936)) ([20cfa7c](https://github.com/wopr-network/wopr/commit/20cfa7ce4c7765507697044d902392ea4b38b3ae))
* use setSessionProviderAsync instead of writing .provider.json to disk (WOP-1534) ([#1856](https://github.com/wopr-network/wopr/issues/1856)) ([36f6d50](https://github.com/wopr-network/wopr/commit/36f6d500aa16f4b8935103e4b60c1e840b3d23f8))
* validate OpenAI message content types, reject non-string silently coerced (WOP-1425) ([#1718](https://github.com/wopr-network/wopr/issues/1718)) ([cf9c659](https://github.com/wopr-network/wopr/commit/cf9c659ad5efe10821b6d731446665fb609ca2ae))
* validate plugin configSchema before init() (WOP-1458) ([#1805](https://github.com/wopr-network/wopr/issues/1805)) ([033f3a8](https://github.com/wopr-network/wopr/commit/033f3a82eec5b58432f5908e839a6cd9a2556811))
* validate plugin manifest against Zod schema at load time (WOP-1499) ([#1837](https://github.com/wopr-network/wopr/issues/1837)) ([f4f1cd6](https://github.com/wopr-network/wopr/commit/f4f1cd683d271217d15acf8149c771dfc1bb69ea))


### Code Refactoring

* extract shared installAndActivatePlugin to unify install paths (WOP-1487) ([#1813](https://github.com/wopr-network/wopr/issues/1813)) ([e22f362](https://github.com/wopr-network/wopr/commit/e22f3628270a140c46809eacb6e9daf38e8baad9))
* remove memory stub from wopr core (WOP-1506) ([#1836](https://github.com/wopr-network/wopr/issues/1836)) ([1531dc9](https://github.com/wopr-network/wopr/commit/1531dc90006dc2d4171dc0472966587d6914b6d7))
* replace require() with dynamic import() (WOP-1435) ([#1840](https://github.com/wopr-network/wopr/issues/1840)) ([b573f86](https://github.com/wopr-network/wopr/commit/b573f860feda7f7f572c0a351eda76788d4e2a63))


### Security

* add hardcoded shell denylist to hook commands (WOP-1423) ([#1719](https://github.com/wopr-network/wopr/issues/1719)) ([ecbca76](https://github.com/wopr-network/wopr/commit/ecbca760b1e081de1102b4ec4c24054dbc75c2da))
* downgrade default plugin trust to semi-trusted (WOP-1408) ([#1716](https://github.com/wopr-network/wopr/issues/1716)) ([3605c0e](https://github.com/wopr-network/wopr/commit/3605c0ec57c9af9471d9320b5d21036629cd1162))
* enforce WebSocket auth at HTTP upgrade time (WOP-1407) ([#1717](https://github.com/wopr-network/wopr/issues/1717)) ([03afdd8](https://github.com/wopr-network/wopr/commit/03afdd8e5c605eb717ed47978f55b9001dbc451a))
* fail closed on hook errors by default (WOP-1378) ([#1637](https://github.com/wopr-network/wopr/issues/1637)) ([a9c6151](https://github.com/wopr-network/wopr/commit/a9c6151ebed7e3f022688db6017061de238add7f))
* guard _setTokenVerifier and _resetForTesting behind NODE_ENV=test (WOP-1389) ([#1644](https://github.com/wopr-network/wopr/issues/1644)) ([90db8ed](https://github.com/wopr-network/wopr/commit/90db8edd11b6fb8b6c72e0559056277e1ed0404b))
* invert seccomp to default-deny with explicit syscall allowlist (WOP-1363) ([#1636](https://github.com/wopr-network/wopr/issues/1636)) ([651fec0](https://github.com/wopr-network/wopr/commit/651fec068fb69a65829e16579b25b7d6649e9578))
* pass --ignore-scripts to npm install in plugin installation (WOP-1388) ([#1645](https://github.com/wopr-network/wopr/issues/1645)) ([cb3630f](https://github.com/wopr-network/wopr/commit/cb3630f0cf95fadc7010fb22e1d9b44f9e7845e2))
* pin rollup to ^4.59.0 to fix path traversal CVE ([88d9baa](https://github.com/wopr-network/wopr/commit/88d9baa5cfefd3dfa3837543f4c17e9f967e1283))
* rate limiter keyed by socket IP, not X-Forwarded-For (WOP-1544) ([#1944](https://github.com/wopr-network/wopr/issues/1944)) ([ae8fe2c](https://github.com/wopr-network/wopr/commit/ae8fe2c6896c678b63ea11a0f4fad4d72976b2a1))
* remove raw()/run() from plugin-facing StorageApi (WOP-1379) ([#1638](https://github.com/wopr-network/wopr/issues/1638)) ([6125904](https://github.com/wopr-network/wopr/commit/6125904a244e98f5439750d2306fddea6273a1b5))
* replace Math.random() with crypto.randomBytes for request IDs (WOP-1420) ([#1804](https://github.com/wopr-network/wopr/issues/1804)) ([8441196](https://github.com/wopr-network/wopr/commit/84411960f57aa38e40ca094df573068b56536b2d))
* replace RegExp with glob matching in canIndexSession (WOP-1421) ([#1720](https://github.com/wopr-network/wopr/issues/1720)) ([c3d31df](https://github.com/wopr-network/wopr/commit/c3d31df3dac5e975203742157afa5324e2e8dda4))
* restrict WOPR_SECURITY_ENFORCEMENT override to dev builds only (WOP-1364) ([#1635](https://github.com/wopr-network/wopr/issues/1635)) ([f7a42f2](https://github.com/wopr-network/wopr/commit/f7a42f23c1d046fdc409a7e4dd8b8de46d1effe9))


### Tests

* add auth-schema and selfdoc-context unit tests (WOP-1392) ([#1648](https://github.com/wopr-network/wopr/issues/1648)) ([ea38a9c](https://github.com/wopr-network/wopr/commit/ea38a9caaa0bd319034c36888694e7abe0ff6e9f))
* add comprehensive unit tests for daemon plugin routes (WOP-1414) ([#1800](https://github.com/wopr-network/wopr/issues/1800)) ([4d1619c](https://github.com/wopr-network/wopr/commit/4d1619c69d3fd8fe27cbea2bcb1f7460053dcf4f))
* add ConfigManager unit tests (WOP-1416) ([#1803](https://github.com/wopr-network/wopr/issues/1803)) ([7a426a5](https://github.com/wopr-network/wopr/commit/7a426a5751872bc953a8156767c56c7991e0c201))
* add coverage for session-migration and auth-migrate (WOP-1367) ([#1642](https://github.com/wopr-network/wopr/issues/1642)) ([196096d](https://github.com/wopr-network/wopr/commit/196096d67c8beb3831b7497463239df719c3c4b1))
* add getConfigFilePath and setConfigFileOverride to paths mock ([#1926](https://github.com/wopr-network/wopr/issues/1926)) ([d0ab0ee](https://github.com/wopr-network/wopr/commit/d0ab0ee429dbce20e5ac667e3a789f9258f370ae))
* add getConfigFilePath and setConfigFileOverride to paths mock in file-permissions tests ([#1858](https://github.com/wopr-network/wopr/issues/1858)) ([a38cd3e](https://github.com/wopr-network/wopr/commit/a38cd3ea9ed047e73b52f787437be7f20aafd548))
* add hook-manager unit tests (WOP-1365) ([#1639](https://github.com/wopr-network/wopr/issues/1639)) ([8c6d33d](https://github.com/wopr-network/wopr/commit/8c6d33d60f67cb128f2839d4f766ee6cab964738))
* add instance routes unit tests (WOP-1415) ([#1801](https://github.com/wopr-network/wopr/issues/1801)) ([536f937](https://github.com/wopr-network/wopr/commit/536f9371caecba0fa5269a26d89eb5a7be813c2f))
* add plugin context factory unit tests (WOP-1417) ([#1806](https://github.com/wopr-network/wopr/issues/1806)) ([a35d113](https://github.com/wopr-network/wopr/commit/a35d113c7f4ce4fd3e75f10d5b0bbef6a371f02b))
* add unit tests for 4 untested security module files (WOP-1066) ([#1301](https://github.com/wopr-network/wopr/issues/1301)) ([ae10954](https://github.com/wopr-network/wopr/commit/ae10954bfab398198dd7b52092ceffc9f3713bf8))
* add unit tests for plugin event-bus wrapper (WOP-1366) ([#1641](https://github.com/wopr-network/wopr/issues/1641)) ([4cf4a0e](https://github.com/wopr-network/wopr/commit/4cf4a0e62e0be1a4ad064381f68837a5de489cd5))
* add unit tests for schema-converter, accessors, migrate-json (WOP-1391) ([#1649](https://github.com/wopr-network/wopr/issues/1649)) ([c20561c](https://github.com/wopr-network/wopr/commit/c20561c5988eb7eea9df17dd333bb203391d95b6))
* add unit tests for skill-frontmatter-parser (WOP-1368) ([#1661](https://github.com/wopr-network/wopr/issues/1661)) ([26e3336](https://github.com/wopr-network/wopr/commit/26e333695d4d42f2aa4a50cbe29a8382f542f442))
* add unit tests for unregisterSetupContextProvider (WOP-1017) ([#1352](https://github.com/wopr-network/wopr/issues/1352)) ([6d8910e](https://github.com/wopr-network/wopr/commit/6d8910e85e11ce27581398fc71e5cc5c2164cb1f))
* add WoprClient unit tests — 92 tests covering full HTTP API (WOP-1413) ([#1802](https://github.com/wopr-network/wopr/issues/1802)) ([9662e8b](https://github.com/wopr-network/wopr/commit/9662e8b8a4191707b80201611139f20f8ffabc04))
* document spoofable x-forwarded-for behavior in rate limiter (WOP-1404) ([#1643](https://github.com/wopr-network/wopr/issues/1643)) ([0a35e09](https://github.com/wopr-network/wopr/commit/0a35e09e855208b28b603cbe63f6b5d411414a04))
* fix flaky beforeEach timeouts in storage/security tests ([#1941](https://github.com/wopr-network/wopr/issues/1941)) ([608f7bb](https://github.com/wopr-network/wopr/commit/608f7bb338e266883ac72c08aeb784589360b6ce))
* restart-on-idle, capability-catalog/deps, a2a-mcp unit tests (WOP-1432) ([#1835](https://github.com/wopr-network/wopr/issues/1835)) ([8e6a032](https://github.com/wopr-network/wopr/commit/8e6a03211b288723aae25a8c7b01b9d165409ca7))
* strengthen weak toBeDefined/toBeTruthy assertions (WOP-1384) ([#1651](https://github.com/wopr-network/wopr/issues/1651)) ([302ddea](https://github.com/wopr-network/wopr/commit/302ddead53b01f14e973362d5105b8ddd9d06ee5))
* use :memory: SQLite in api-keys and storage tests ([#2005](https://github.com/wopr-network/wopr/issues/2005)) ([c41902d](https://github.com/wopr-network/wopr/commit/c41902df9f0d01b0701eda71e188d682c0cb21aa))


### Documentation

* add launch day runbook for April 1 drop (WOP-456) ([#1487](https://github.com/wopr-network/wopr/issues/1487)) ([17d08ad](https://github.com/wopr-network/wopr/commit/17d08ad465aff98a62860ad1e8a7b20a36f1733e))
* update CLAUDE.md gotchas from WOP-1407 fixer findings ([fb1cc2f](https://github.com/wopr-network/wopr/commit/fb1cc2fcd894607c807993afaf97ba74a0e75a79))
* update CLAUDE.md gotchas from WOP-1461 fixer findings ([94aa34a](https://github.com/wopr-network/wopr/commit/94aa34ad11299aa7e3b515972f4486b2f4b6cc13))


### Miscellaneous

* add MIT license ([bd0db6a](https://github.com/wopr-network/wopr/commit/bd0db6aea1517926ab7bba155bf60a4f5a31ccd5))
* **ci:** bump actions/checkout from 4 to 6 ([#1656](https://github.com/wopr-network/wopr/issues/1656)) ([3c246d1](https://github.com/wopr-network/wopr/commit/3c246d11fc84cdb994b4be9d1350307f88ef29b9))
* **ci:** bump actions/download-artifact from 7 to 8 ([#1655](https://github.com/wopr-network/wopr/issues/1655)) ([ed0986b](https://github.com/wopr-network/wopr/commit/ed0986b9d39374325c576f67c2339e1c332b3c87))
* **ci:** bump actions/setup-node from 4 to 6 ([#1654](https://github.com/wopr-network/wopr/issues/1654)) ([90ed085](https://github.com/wopr-network/wopr/commit/90ed085f9055e5f22a09b186d49d7f33c910e17d))
* **deps:** bump @anthropic-ai/claude-agent-sdk from 0.2.44 to 0.2.63 ([#1657](https://github.com/wopr-network/wopr/issues/1657)) ([37025c7](https://github.com/wopr-network/wopr/commit/37025c71dbab55c1db6034c80e442c29d88413ac))
* **deps:** bump @scalar/hono-api-reference from 0.9.44 to 0.9.46 ([#1660](https://github.com/wopr-network/wopr/issues/1660)) ([5abd495](https://github.com/wopr-network/wopr/commit/5abd49554cd0a5d7c619823f94f80577276b7125))
* **deps:** bump @types/node from 25.3.0 to 25.3.3 ([#1659](https://github.com/wopr-network/wopr/issues/1659)) ([686f957](https://github.com/wopr-network/wopr/commit/686f957b02b01a694054c5772368de00d54ccfd9))
* **deps:** bump hono from 4.12.2 to 4.12.3 ([#1658](https://github.com/wopr-network/wopr/issues/1658)) ([6543ac9](https://github.com/wopr-network/wopr/commit/6543ac9b2d836a5170dc7510d45a3ba8db561d2b))
* pull node base image from GHCR mirror to avoid Docker Hub rate limits ([#1843](https://github.com/wopr-network/wopr/issues/1843)) ([5f02ca7](https://github.com/wopr-network/wopr/commit/5f02ca7b7e7eb44a599f2799b5ef53e109d895b0))
* skip docker builds on PRs, only run on main and tags ([#1940](https://github.com/wopr-network/wopr/issues/1940)) ([c091dde](https://github.com/wopr-network/wopr/commit/c091ddeb3013c2b5840d721ebfee548805ad0735))


### DevOps

* remove Trivy from Docker build workflow (WOP-1126) ([#1587](https://github.com/wopr-network/wopr/issues/1587)) ([d3ef3f9](https://github.com/wopr-network/wopr/commit/d3ef3f903c15cf5ecc64ff31d864a7b5a64a6578))

## [1.5.0](https://github.com/wopr-network/wopr/compare/wopr-v1.4.1...wopr-v1.5.0) (2026-02-27)


### Features

* add voice channel broadcast with PCM/Opus encoding (WOP-965) ([#1276](https://github.com/wopr-network/wopr/issues/1276)) ([d4a3826](https://github.com/wopr-network/wopr/commit/d4a3826df29544f1291405af9bfdd26680c2b9ac))
* setup context provider registration, injection, and tests (WOP-1054) ([#1272](https://github.com/wopr-network/wopr/issues/1272)) ([343883e](https://github.com/wopr-network/wopr/commit/343883e253d46d4bfbec21c1f7ef1a704e2fb1c8))


### Bug Fixes

* remove circular init side-effect, call initContextSystem explicitly in daemon startup ([#1300](https://github.com/wopr-network/wopr/issues/1300)) ([193a838](https://github.com/wopr-network/wopr/commit/193a838742f4a9a01e76ccc8ca827c88c1807b92))
* replace su-exec with gosu and wget with curl for Debian compatibility (WOP-944) ([#1275](https://github.com/wopr-network/wopr/issues/1275)) ([301e51d](https://github.com/wopr-network/wopr/commit/301e51da9a1672fdce20980c648abe5a4c2fc759))
* use node fetch for promotion smoke test health check (WOP-943) ([#1277](https://github.com/wopr-network/wopr/issues/1277)) ([5e6470a](https://github.com/wopr-network/wopr/commit/5e6470a2b5a0b2f276d89f2df94ab1f3e6f42f8a))


### Code Refactoring

* eliminate any type annotations in wopr core (WOP-745) ([#1274](https://github.com/wopr-network/wopr/issues/1274)) ([d0c6354](https://github.com/wopr-network/wopr/commit/d0c6354545bde20b41d24304d90278ace6aaa9df))

## [1.4.1](https://github.com/wopr-network/wopr/compare/wopr-v1.4.0...wopr-v1.4.1) (2026-02-25)


### Miscellaneous

* migrate base image from Alpine to Debian bookworm-slim (WOP-1039) ([#1254](https://github.com/wopr-network/wopr/issues/1254)) ([6c17a00](https://github.com/wopr-network/wopr/commit/6c17a00366aad37ee01e76214195448f7dfb7f0d))

## [1.4.0](https://github.com/wopr-network/wopr/compare/wopr-v1.3.10...wopr-v1.4.0) (2026-02-25)


### Features

* add superpower category and marketplace metadata to PluginManifest (WOP-1010) ([#1242](https://github.com/wopr-network/wopr/issues/1242)) ([ba51588](https://github.com/wopr-network/wopr/commit/ba5158804e24ad56cf1e222756da1b4f02965334))
* **plugins:** resolve and auto-install manifest.dependencies on plugin load (WOP-1014) ([#1233](https://github.com/wopr-network/wopr/issues/1233)) ([a2c6548](https://github.com/wopr-network/wopr/commit/a2c6548bb1499d8db8d1cae87c337eb21eb85ac5))


### Code Refactoring

* **core:** remove leaked registry storage from core (WOP-962) ([#1234](https://github.com/wopr-network/wopr/issues/1234)) ([1635676](https://github.com/wopr-network/wopr/commit/163567692c23a92b8d195be44a54fb7f0da7f0ed))

## [1.3.10](https://github.com/wopr-network/wopr/compare/wopr-v1.3.9...wopr-v1.3.10) (2026-02-25)


### Bug Fixes

* **docker:** multi-stage build — remove pnpm corepack cache from runtime image ([7e3de22](https://github.com/wopr-network/wopr/commit/7e3de22e56aa639b75d2f863fbfa922b438b5665))
* **docker:** slim image — update npm to patch bundled tar/minimatch CVEs, clear corepack cache in deps stage ([7569af2](https://github.com/wopr-network/wopr/commit/7569af227ba15feb647b0d591bdb598642dcd299))


### Miscellaneous

* ignore CVE-2024-24790 — Go stdlib in node:24-alpine base image, not our code ([707712a](https://github.com/wopr-network/wopr/commit/707712a2c1cc9231e0763cd02265dfe5439339a1))

## [1.3.9](https://github.com/wopr-network/wopr/compare/wopr-v1.3.8...wopr-v1.3.9) (2026-02-24)


### Code Refactoring

* remove built-in skill command, now in wopr-plugin-skills (WOP-737) ([#1190](https://github.com/wopr-network/wopr/issues/1190)) ([0cdcda1](https://github.com/wopr-network/wopr/commit/0cdcda15c75e7d0b985cd3835939c88a42b932f3))
* remove hardcoded cron CLI, delegate to wopr-plugin-cron (WOP-738) ([#1191](https://github.com/wopr-network/wopr/issues/1191)) ([e241ea2](https://github.com/wopr-network/wopr/commit/e241ea248d16753f42844a1e0c71e4453bc5f31b))


### Miscellaneous

* **deps:** bump drizzle-orm from 0.39.3 to 0.45.1 ([#1163](https://github.com/wopr-network/wopr/issues/1163)) ([2af2417](https://github.com/wopr-network/wopr/commit/2af2417b32bc48ca30a63b5eaa996fcf30e5e48d))

## [1.3.8](https://github.com/wopr-network/wopr/compare/wopr-v1.3.7...wopr-v1.3.8) (2026-02-24)


### Bug Fixes

* add unregisterA2AServer for plugin cleanup (Fixes WOP-971) ([#1174](https://github.com/wopr-network/wopr/issues/1174)) ([554ab79](https://github.com/wopr-network/wopr/commit/554ab7903c3eca5497531387df7d82ae95a3a09c))


### Miscellaneous

* **ci:** bump actions/github-script from 7 to 8 ([#1158](https://github.com/wopr-network/wopr/issues/1158)) ([6c6bc4f](https://github.com/wopr-network/wopr/commit/6c6bc4f47b180c074df09889780de769ce2a5276))
* **ci:** bump actions/upload-artifact from 4 to 6 ([#1157](https://github.com/wopr-network/wopr/issues/1157)) ([b675ce3](https://github.com/wopr-network/wopr/commit/b675ce35c65b2e197fd93597c4e92c8ca4f6b1a3))

## [1.3.7](https://github.com/wopr-network/wopr/compare/wopr-v1.3.6...wopr-v1.3.7) (2026-02-22)


### Tests

* **wop-954:** unit tests for DrizzleRepository — 51 tests covering gaps ([#1155](https://github.com/wopr-network/wopr/issues/1155)) ([3bc1627](https://github.com/wopr-network/wopr/commit/3bc1627ec5f2ca35b65d74f6a44eff4cb06ee03a))

## [1.3.6](https://github.com/wopr-network/wopr/compare/wopr-v1.3.5...wopr-v1.3.6) (2026-02-22)


### Security

* wrap plugin A2A tools with withSecurityCheck (WOP-919) ([#1125](https://github.com/wopr-network/wopr/issues/1125)) ([e774c0c](https://github.com/wopr-network/wopr/commit/e774c0c2da5c933439495f786cd2af812e0a5994))

## [1.3.5](https://github.com/wopr-network/wopr/compare/wopr-v1.3.4...wopr-v1.3.5) (2026-02-22)


### Miscellaneous

* **deps:** bump aquasecurity/trivy-action in /.github/workflows ([#1074](https://github.com/wopr-network/wopr/issues/1074)) ([775fa8b](https://github.com/wopr-network/wopr/commit/775fa8b60732929f06562b3517b324860d274238))
* **deps:** bump hono from 4.11.9 to 4.11.10 ([#1075](https://github.com/wopr-network/wopr/issues/1075)) ([7f6b53b](https://github.com/wopr-network/wopr/commit/7f6b53b689406c7ed42e333bfd4ab345b45fc24c))

## [1.3.4](https://github.com/wopr-network/wopr/compare/wopr-v1.3.3...wopr-v1.3.4) (2026-02-21)


### Bug Fixes

* restore stable promotion workflow (WOP-735, WOP-736) ([#1039](https://github.com/wopr-network/wopr/issues/1039)) ([f68d695](https://github.com/wopr-network/wopr/commit/f68d69545a0b699574e12d74032d5e1071257744))


### Code Refactoring

* extract metrics to wopr-plugin-metrics (WOP-553) ([#1065](https://github.com/wopr-network/wopr/issues/1065)) ([0cf5060](https://github.com/wopr-network/wopr/commit/0cf5060c5b70eb2f1c31ae240aee8a880a40b14e))


### Security

* validate local plugin source path before symlink creation (WOP-743) ([#1070](https://github.com/wopr-network/wopr/issues/1070)) ([c421be4](https://github.com/wopr-network/wopr/commit/c421be4db63d4ecc4bace39358a604534e29d6c8))

## [1.3.3](https://github.com/wopr-network/wopr/compare/wopr-v1.3.2...wopr-v1.3.3) (2026-02-20)


### Bug Fixes

* use scoped package names in npm install path (WOP-819) ([#1025](https://github.com/wopr-network/wopr/issues/1025)) ([a20da26](https://github.com/wopr-network/wopr/commit/a20da264eb5fafd33203023172b2f0cbf174c475))

## [1.3.2](https://github.com/wopr-network/wopr/compare/wopr-v1.3.1...wopr-v1.3.2) (2026-02-20)


### Tests

* add return value test for repo.transaction() (WOP-836) ([#1019](https://github.com/wopr-network/wopr/issues/1019)) ([dc2ffcc](https://github.com/wopr-network/wopr/commit/dc2ffcc8b59528d6844cf659e269c4523e5f17bd))

## [1.3.1](https://github.com/wopr-network/wopr/compare/wopr-v1.3.0...wopr-v1.3.1) (2026-02-20)


### Documentation

* add session memory recall instruction ([#1018](https://github.com/wopr-network/wopr/issues/1018)) ([ea2078f](https://github.com/wopr-network/wopr/commit/ea2078fc9de6a2e7c75022a8cf9c06ef0d4d5629))


### Miscellaneous

* enable wopr-hooks claude plugin ([#1016](https://github.com/wopr-network/wopr/issues/1016)) ([b07fe74](https://github.com/wopr-network/wopr/commit/b07fe741b871cc464bb95bf0395fbfd56038bec4))

## [1.3.0](https://github.com/wopr-network/wopr/compare/wopr-v1.2.0...wopr-v1.3.0) (2026-02-19)


### Features

* add resolveCapability() and resolveAllProviders() to core (WOP-491) ([#783](https://github.com/wopr-network/wopr/issues/783)) ([368bdc4](https://github.com/wopr-network/wopr/commit/368bdc4f258ec0299031060a1366bee102a94d70))
* generate OpenAPI specs and publish API reference (WOP-522) ([#814](https://github.com/wopr-network/wopr/issues/814)) ([1a0dd84](https://github.com/wopr-network/wopr/commit/1a0dd8489455a7490307063dd6c9fe5ee861fcbe))
* migrate session context files to Storage API (WOP-556) ([#797](https://github.com/wopr-network/wopr/issues/797)) ([a58b060](https://github.com/wopr-network/wopr/commit/a58b06001cacbf3b1db0d2bf1d5103d23dd7af83))
* **WOP-268:** add WebMCP provider model endpoints and extensions ([#799](https://github.com/wopr-network/wopr/issues/799)) ([071eff9](https://github.com/wopr-network/wopr/commit/071eff941234d2fd74dfb1c440527924e0085326))


### Bug Fixes

* add checkout step so agentic Claude can run git operations ([e4bd0ec](https://github.com/wopr-network/wopr/commit/e4bd0ec36c81f858aed3dcf75c8b54fbad781fe2))
* add timeout to execSync calls in sandbox setup (WOP-613) ([#795](https://github.com/wopr-network/wopr/issues/795)) ([8246d0d](https://github.com/wopr-network/wopr/commit/8246d0de7dfd91dde73e22dede97d736ead97a47))
* apply .filter(Boolean) to cleanupAllSandboxes() for consistency (WOP-612) ([106ad78](https://github.com/wopr-network/wopr/commit/106ad78dd6feac7b6d24358aaabd0ef9577204de))
* correct phantom repo refs in capability catalog (WOP-616) ([87dc964](https://github.com/wopr-network/wopr/commit/87dc9645623eba7b26bceea5e756fb1d11f55515))
* correct phantom repo refs in capability catalog (WOP-616) ([87dc964](https://github.com/wopr-network/wopr/commit/87dc9645623eba7b26bceea5e756fb1d11f55515))
* correct phantom repo refs in capability-catalog (WOP-616) ([62519a9](https://github.com/wopr-network/wopr/commit/62519a98a6ba4007408d6601ec65b18010f51886))
* destroySandbox() removes all containers not just first (WOP-612) ([f4f9ec7](https://github.com/wopr-network/wopr/commit/f4f9ec7afa7f9fc8af040ea74716917a3001dcd6))
* destroySandbox() removes all containers not just first (WOP-612) ([f4f9ec7](https://github.com/wopr-network/wopr/commit/f4f9ec7afa7f9fc8af040ea74716917a3001dcd6))
* destroySandbox() removes all containers not just first (WOP-612) ([d38ff97](https://github.com/wopr-network/wopr/commit/d38ff9785ac477581e66ce004555f16819b2a621))
* replace hardcoded /data paths with WOPR_HOME-derived constants (WOP-615) ([8559720](https://github.com/wopr-network/wopr/commit/855972007fe27334039d9a3511ef9d9ef7ff5ad7))
* resolve signal exit codes in sandbox containers (WOP-611) ([6da5511](https://github.com/wopr-network/wopr/commit/6da5511274b673ebd06969e77a935fb4ef3807cd))
* resolve signal exit codes in sandbox containers (WOP-611) ([6da5511](https://github.com/wopr-network/wopr/commit/6da5511274b673ebd06969e77a935fb4ef3807cd))
* resolve signal exit codes in sandbox containers (WOP-611) ([0e47fc6](https://github.com/wopr-network/wopr/commit/0e47fc604448eb86454212efd71b2524447cdd20))
* set 0o600 permissions on all config/credential file writes (WOP-621) ([a416b11](https://github.com/wopr-network/wopr/commit/a416b1152cecfa60e5a07fb60534093ca62c0df4))
* trigger on either reviewer, not both — 3min window for second reviewer ([d60a7c2](https://github.com/wopr-network/wopr/commit/d60a7c286a53c82aaf12e6bc30106a3a0755b98f))


### Security

* Change default enforcement mode from warn to enforce (WOP-623) ([#787](https://github.com/wopr-network/wopr/issues/787)) ([3fd73ac](https://github.com/wopr-network/wopr/commit/3fd73acf90265bff682c2aabc5af09d4d9bda050))
* fail-closed on missing security context (WOP-610) ([#788](https://github.com/wopr-network/wopr/issues/788)) ([0c4ecf0](https://github.com/wopr-network/wopr/commit/0c4ecf0c8a76fd81a4fe92291fd7ab5e96756985))
* restrict CORS to localhost origins (WOP-622) ([aa17526](https://github.com/wopr-network/wopr/commit/aa1752689745a4609c5d50f5de7b0cc4f2a6c700))


### Documentation

* add plugin development handbook (WOP-523) ([#798](https://github.com/wopr-network/wopr/issues/798)) ([43ff9b5](https://github.com/wopr-network/wopr/commit/43ff9b525f3bf3c6b1fae94d273d048efb4081a0))


### Miscellaneous

* apply pre-existing biome format fixes (WOP-612) ([b75527e](https://github.com/wopr-network/wopr/commit/b75527e6c57a768cd515533499956821d75c4487))
* remove passive review workflow, keeping agentic claude-code.yml ([f047b68](https://github.com/wopr-network/wopr/commit/f047b68a0cc93e40476b0ee8c87d2f9a4fbe4ae7))

## [1.2.0](https://github.com/wopr-network/wopr/compare/wopr-v1.1.0...wopr-v1.2.0) (2026-02-18)


### Features

* **storage:** SQL field projection and real transactions in DrizzleRepository (WOP-598) ([#763](https://github.com/wopr-network/wopr/issues/763)) ([752c363](https://github.com/wopr-network/wopr/commit/752c3635a6279d2c30d1d9900deed625fa528152))
* zero-click capability activation endpoint (WOP-504) ([#729](https://github.com/wopr-network/wopr/issues/729)) ([ab38a1b](https://github.com/wopr-network/wopr/commit/ab38a1bbdade1f73ce0e382181fb5face5ed41bf))


### Code Refactoring

* extract http_fetch and exec_command into wopr-plugin-tools (WOP-567) ([#750](https://github.com/wopr-network/wopr/issues/750)) ([fde78b8](https://github.com/wopr-network/wopr/commit/fde78b80dc1f882cb9419379c1e939958baae06e))
* remove ACP from core, delegate to wopr-plugin-acp (WOP-571) ([#748](https://github.com/wopr-network/wopr/issues/748)) ([4c782d0](https://github.com/wopr-network/wopr/commit/4c782d07ea11ad709c78023cd6ff952637593e6a))
* remove browser module from core (WOP-551) ([#734](https://github.com/wopr-network/wopr/issues/734)) ([8df2b5e](https://github.com/wopr-network/wopr/commit/8df2b5e20f16eb90e6e53bb43bb45b0cf8795946))
* remove canvas module from core (WOP-562) ([#735](https://github.com/wopr-network/wopr/issues/735)) ([25f2a97](https://github.com/wopr-network/wopr/commit/25f2a97edb6570c0eaad35058d8fb7ccee50759a))
* remove image generation from core (WOP-564) ([#732](https://github.com/wopr-network/wopr/issues/732)) ([e29c158](https://github.com/wopr-network/wopr/commit/e29c15875dd9f0f19dc9e529c3cd29d95de9f617))
* remove notify tool from core (WOP-568) ([#736](https://github.com/wopr-network/wopr/issues/736)) ([ba5b889](https://github.com/wopr-network/wopr/commit/ba5b8897d8ba9579ae5a823a9f2047b51fb87700))
* remove pairing module from core (WOP-570) ([#737](https://github.com/wopr-network/wopr/issues/737)) ([827f837](https://github.com/wopr-network/wopr/commit/827f8370ab5ccf0872a47dc0b8376590ee9c4543))
* remove sandbox from core, delegate to wopr-plugin-sandbox (WOP-569) ([#749](https://github.com/wopr-network/wopr/issues/749)) ([fcb7d3f](https://github.com/wopr-network/wopr/commit/fcb7d3fe257b09ef3ed2210d6873cbd30984d7de))
* remove soul A2A tools from core (WOP-566) ([#738](https://github.com/wopr-network/wopr/issues/738)) ([6d98457](https://github.com/wopr-network/wopr/commit/6d9845761218ff58c838c9eaf662574bd5d05d64))
* remove src/voice/ from core — plugins own their own types (WOP-495) ([#731](https://github.com/wopr-network/wopr/issues/731)) ([d45cdb8](https://github.com/wopr-network/wopr/commit/d45cdb88bc5651e0829ec902afdad56262ace511))
* remove web search from core (WOP-565) ([#733](https://github.com/wopr-network/wopr/issues/733)) ([02a0400](https://github.com/wopr-network/wopr/commit/02a0400516e095f64c7335a737179cd65fbcd455))
* rename registerProvider → registerLLMProvider (WOP-609) ([#767](https://github.com/wopr-network/wopr/issues/767)) ([390da4f](https://github.com/wopr-network/wopr/commit/390da4fdb12a53d51d0b82763963365cbde8248e))


### Documentation

* add brand voice + pre-launch Twitter plan ([#554](https://github.com/wopr-network/wopr/issues/554)) ([a8eac21](https://github.com/wopr-network/wopr/commit/a8eac21c0cd35456fea11450eb35f416e8929a8a))
* add CLAUDE.md and ignore .worktrees/ directory ([#751](https://github.com/wopr-network/wopr/issues/751)) ([af7c966](https://github.com/wopr-network/wopr/commit/af7c9662fd5c21460a0cebc1d5529084d0a3b4e9))

## [1.1.0](https://github.com/wopr-network/wopr/compare/wopr-v1.0.0...wopr-v1.1.0) (2026-02-17)


### Features

* **a2a:** Add Agent-to-Agent (A2A) communication support ([29a5af3](https://github.com/wopr-network/wopr/commit/29a5af3ab87d9b6061f446fe0c02dc71551d18b7))
* **a2a:** add system primitives and clawdbot-style memory tools ([6f8d762](https://github.com/wopr-network/wopr/commit/6f8d7624702ff73e041e9d3331e410fa13309c95))
* **a2a:** Enable A2A by default, allow opt-out via config ([5baa039](https://github.com/wopr-network/wopr/commit/5baa039d25237cc06152ea7c98d1c7f5cb2dc3a0))
* ACP/IDE bridge for editor integration (WOP-112) ([#375](https://github.com/wopr-network/wopr/issues/375)) ([fbb6f61](https://github.com/wopr-network/wopr/commit/fbb6f6158cec99120a01c44c02054318d2997aea))
* Add 'wopr session log' command to log messages without AI response ([516b757](https://github.com/wopr-network/wopr/commit/516b757cff5aa91cf65dc4af07aa55c64d40e690))
* add baseUrl override to ProviderConfig for hosted-mode gateway routing (WOP-465) ([#567](https://github.com/wopr-network/wopr/issues/567)) ([5bbfbc7](https://github.com/wopr-network/wopr/commit/5bbfbc7b036fe79ff9d5d3aeef42ef2b7a6f6e87))
* add capability health probes and provider status UI (WOP-501) ([#703](https://github.com/wopr-network/wopr/issues/703)) ([f4e9505](https://github.com/wopr-network/wopr/commit/f4e9505fbaeb075f5d9272be5e40ed0ce74e469d))
* add capability_discover A2A tool and REST endpoint (WOP-503) ([#691](https://github.com/wopr-network/wopr/issues/691)) ([be4203d](https://github.com/wopr-network/wopr/commit/be4203d81184fe3d063619f4f0e3924e445bb437))
* Add clawdbot-style workspace/identity system (AGENTS.md, SOUL.md, etc.) ([ee203bb](https://github.com/wopr-network/wopr/commit/ee203bb7c4117afedb430198989b63a37d2319ad))
* add conversation_history context provider ([1841b4e](https://github.com/wopr-network/wopr/commit/1841b4e89d49792fd6c004f6c50a4b1d2970d7cf))
* Add core queue system for FIFO inject ordering ([#9](https://github.com/wopr-network/wopr/issues/9)) ([0ad3145](https://github.com/wopr-network/wopr/commit/0ad31459dada9c2df80fbf76e33d004e6d7c6e8c))
* Add cron execution history tracking ([082835f](https://github.com/wopr-network/wopr/commit/082835f676165c367b357e6a0e4ea99383fe9ca4))
* add hosted provider types and meter events (WOP-298) ([#392](https://github.com/wopr-network/wopr/issues/392)) ([328b119](https://github.com/wopr-network/wopr/commit/328b1197d05c5e3941d2c25b5ea88c8c851fad3e))
* Add iMessage to onboarding wizard ([b546ccd](https://github.com/wopr-network/wopr/commit/b546ccd75b43ba742ed145efc91edc84f2bb0853))
* Add interactive onboard wizard (wopr onboard) ([04a5523](https://github.com/wopr-network/wopr/commit/04a5523b21b5f5708ec90d2eeefcf929cdb3f8e6))
* add Kimi (Moonshot AI) provider support ([1a0fdbf](https://github.com/wopr-network/wopr/commit/1a0fdbf37218f3c71f5d7d3eb5624992451398d8))
* Add logMessage() to plugin context for capturing context without AI query ([f9d27b5](https://github.com/wopr-network/wopr/commit/f9d27b53a92beda6a473c7877064b698d83ee345))
* add manifest support to core plugin loader (WOP-64) ([#122](https://github.com/wopr-network/wopr/issues/122)) ([06d4a06](https://github.com/wopr-network/wopr/commit/06d4a0666300a524d93f9aa3f9cfc6c95f661387))
* add multi-provider model system with web UI ([80c51c1](https://github.com/wopr-network/wopr/commit/80c51c174cc37d0763b89e6ab7f75ef5da5f4bc8))
* add OpenCode provider support ([9c54eb6](https://github.com/wopr-network/wopr/commit/9c54eb6ba605f6d88b0daaefbb1aecb8ec323889))
* add plugin capability resolution system (WOP-490) ([#593](https://github.com/wopr-network/wopr/issues/593)) ([2afd089](https://github.com/wopr-network/wopr/commit/2afd0890259becdca97d26b1ec3171d1c353e805))
* add plugin management API endpoints (WOP-228) ([#277](https://github.com/wopr-network/wopr/issues/277)) ([f518176](https://github.com/wopr-network/wopr/commit/f518176a562c2019ada6c89f83b8617a2a69d777))
* add plugin reload command and API endpoint ([#1](https://github.com/wopr-network/wopr/issues/1)) ([48dc73f](https://github.com/wopr-network/wopr/commit/48dc73f8cc4c56a56002798debdf05bab09092db))
* add plugin-driven Web UI extension system ([cf95582](https://github.com/wopr-network/wopr/commit/cf955822083ac3003691d9d458b4666b41263eac))
* add rate limiting middleware to daemon API (WOP-59) ([#120](https://github.com/wopr-network/wopr/issues/120)) ([2d10900](https://github.com/wopr-network/wopr/commit/2d10900bac8aa207bac078fb8bd25bd7a81bada2))
* add readiness probe endpoint (GET /ready) ([#115](https://github.com/wopr-network/wopr/issues/115)) ([9875ff1](https://github.com/wopr-network/wopr/commit/9875ff1ad828d657c3181fd8c5dc1b4cceb71e7c))
* Add self-documentation context provider (SOUL.md, AGENTS.md, IDENTITY.md, USER.md, MEMORY.md) ([b4a2593](https://github.com/wopr-network/wopr/commit/b4a25932e6ad2ca9393e2e00431608ba53e159bd))
* add senderId to inject and logMessage options ([#12](https://github.com/wopr-network/wopr/issues/12)) ([fb1af60](https://github.com/wopr-network/wopr/commit/fb1af60c77776befd7650e03f5f0e85823e3c2ed))
* Add Slack to onboarding wizard channels ([c45c7c9](https://github.com/wopr-network/wopr/commit/c45c7c961ecaf18cdc2bf9163968d99e76c4f226))
* Add V2 session API for active session injection ([#6](https://github.com/wopr-network/wopr/issues/6)) ([741da74](https://github.com/wopr-network/wopr/commit/741da7463af933a3b6204bbebf88319c3648ee84))
* add vision support to OpenAI Codex provider ([b15e192](https://github.com/wopr-network/wopr/commit/b15e192533c26c2055b693eb2f8bb2f4b3445324))
* add WOPR logo and update README header ([72753e5](https://github.com/wopr-network/wopr/commit/72753e5832bba55ee9d9d66b6f50986b7aaeb43a))
* API key management — generate, scope, revoke (WOP-209) ([#391](https://github.com/wopr-network/wopr/issues/391)) ([7eef8fd](https://github.com/wopr-network/wopr/commit/7eef8fdcacf7ac69929dfb94316b3ad04a59a88b))
* **auth:** credential injection via env vars and encryption at rest (WOP-68) ([#121](https://github.com/wopr-network/wopr/issues/121)) ([a21a6e6](https://github.com/wopr-network/wopr/commit/a21a6e630d948ab17057f9e09d2803e6ded75c31))
* **auth:** Migrate auth.json and auth.sqlite to Storage API (WOP-546) ([#676](https://github.com/wopr-network/wopr/issues/676)) ([8e41f9d](https://github.com/wopr-network/wopr/commit/8e41f9d6153ef6d59d4a5722568e9b0ccb6565a3))
* auto-discover capability providers from manifest (WOP-511) ([#660](https://github.com/wopr-network/wopr/issues/660)) ([862c485](https://github.com/wopr-network/wopr/commit/862c4855f9c266d6fb75bbeeea39f7eeaff50d22))
* browser automation tool — Playwright/CDP (WOP-109) ([#341](https://github.com/wopr-network/wopr/issues/341)) ([11a07f2](https://github.com/wopr-network/wopr/commit/11a07f25a212f9ba60f335770ef59fe95426f29b))
* Canvas/A2UI agent-driven visual workspace (WOP-113) ([#394](https://github.com/wopr-network/wopr/issues/394)) ([65e4d54](https://github.com/wopr-network/wopr/commit/65e4d5434911baefa6d113b3efa2e5634b40eed2))
* centralized config schema system for providers ([b2ca5d9](https://github.com/wopr-network/wopr/commit/b2ca5d9bb94f45a965c93799e4ea407ef197ea55))
* composable context provider system ([83bfa1a](https://github.com/wopr-network/wopr/commit/83bfa1ae85dcffa664c6e803660ce31987eca2e8))
* context provider control, readable session keys, compact handling ([d2b1175](https://github.com/wopr-network/wopr/commit/d2b1175e4d7180dfcc5f02846db00eb3a56b9851))
* core module improvements ([9a9902d](https://github.com/wopr-network/wopr/commit/9a9902d9202427b7f73588a8720bd2e16558e5b2))
* core module improvements ([#24](https://github.com/wopr-network/wopr/issues/24)) ([edf3f82](https://github.com/wopr-network/wopr/commit/edf3f820fba26a558f77da3643686c669511ad89))
* create canonical plugin-types module (WOP-62) ([#112](https://github.com/wopr-network/wopr/issues/112)) ([d697ef8](https://github.com/wopr-network/wopr/commit/d697ef8fe45156349f91095fba9bc45cfe8ba061))
* cron script execution with output templating (WOP-90) ([#141](https://github.com/wopr-network/wopr/issues/141)) ([a4e7e3d](https://github.com/wopr-network/wopr/commit/a4e7e3d6709ee16195a028c276ef7759ffd37589))
* cross-channel DM pairing — unified identity (WOP-114) ([#333](https://github.com/wopr-network/wopr/issues/333)) ([21b6b0e](https://github.com/wopr-network/wopr/commit/21b6b0ed88e9097d769991580114598535507e92))
* daemon routes and inject queue ([#22](https://github.com/wopr-network/wopr/issues/22)) ([58b406b](https://github.com/wopr-network/wopr/commit/58b406b9a20e97bf6d6fd3f7f8a9c2f1e397a900))
* daemon skill management API endpoints (WOP-229) ([#278](https://github.com/wopr-network/wopr/issues/278)) ([73db2b6](https://github.com/wopr-network/wopr/commit/73db2b6cf35329e8f3bd2fe14bb606121800bc45))
* design plugin manifest spec (WOP-63) ([#117](https://github.com/wopr-network/wopr/issues/117)) ([8e1d365](https://github.com/wopr-network/wopr/commit/8e1d3657cc2104d15ab7b168b8c6be7864a4ac7a))
* embeddings onboarding step and architecture docs ([#16](https://github.com/wopr-network/wopr/issues/16)) ([595a0f4](https://github.com/wopr-network/wopr/commit/595a0f4df8aa9249bea0de6202a04edcc209ab72))
* emit MeterEvents from chat/LLM provider calls (WOP-349) ([#501](https://github.com/wopr-network/wopr/issues/501)) ([5e981a7](https://github.com/wopr-network/wopr/commit/5e981a7689cfb352ec3d1aed77d5a8c72dfaa836))
* Enhance http_fetch with better header documentation and response headers ([ea5f311](https://github.com/wopr-network/wopr/commit/ea5f311c1b9449bf8d37fc89233a25d4e6eb01b3))
* **events:** Implement core event bus system with plugin events and hooks API ([4a3d326](https://github.com/wopr-network/wopr/commit/4a3d3262685220e4cbf4fa0f2d1752054c415ff9))
* extract memory module to plugin (WOP-538) ([#664](https://github.com/wopr-network/wopr/issues/664)) ([387c55b](https://github.com/wopr-network/wopr/commit/387c55b5ab86cc1e40094acc440ef97616f3d0f8))
* fleet management API + seed bot profiles (WOP-221) ([#306](https://github.com/wopr-network/wopr/issues/306)) ([552ef36](https://github.com/wopr-network/wopr/commit/552ef361567ad22b5a7d93d4b6f5541f2f623ba0))
* Fleet Manager core — Docker API integration + REST endpoints (WOP-220) ([#312](https://github.com/wopr-network/wopr/issues/312)) ([a959488](https://github.com/wopr-network/wopr/commit/a9594886335757d0571c156418321a672ae2004e))
* generic capability billing system (WOP-500) ([#614](https://github.com/wopr-network/wopr/issues/614)) ([4a11672](https://github.com/wopr-network/wopr/commit/4a116722bc3a725b6a473b14a7f108600f3c7bc4))
* generic plugin hot-load/unload with drain semantics (WOP-515) ([#702](https://github.com/wopr-network/wopr/issues/702)) ([4c3afd7](https://github.com/wopr-network/wopr/commit/4c3afd71e5589d5e55403d6c04c33176f22dfef9))
* hot plugin reload without daemon restart ([fb43cf5](https://github.com/wopr-network/wopr/commit/fb43cf53ede2c679938e01ed90b32fbaba2d1eeb))
* hybrid provider plugin architecture ([7b57afa](https://github.com/wopr-network/wopr/commit/7b57afa782ad0b36b1a6abbd6bf56837aeeeed91))
* image generation tool — DALL-E (WOP-110) ([#338](https://github.com/wopr-network/wopr/issues/338)) ([5e17863](https://github.com/wopr-network/wopr/commit/5e178632fdea7ae242f4d4d866a997b16f50fa07))
* implement MCP socket bridge in core sandbox (WOP-105) ([#195](https://github.com/wopr-network/wopr/issues/195)) ([24d3352](https://github.com/wopr-network/wopr/commit/24d335297dacf2304cb6756139d156db80608b32))
* implement plugin storage API with Drizzle ORM (WOP-535) ([#655](https://github.com/wopr-network/wopr/issues/655)) ([f4ebfee](https://github.com/wopr-network/wopr/commit/f4ebfee3fc8ba1191519afb9cfe9b35b3d343c21))
* instance CRUD REST endpoints (WOP-202) ([#354](https://github.com/wopr-network/wopr/issues/354)) ([09b4bb9](https://github.com/wopr-network/wopr/commit/09b4bb972a496b7484b7e1b6c1c65b06fc0599d1))
* instance health monitoring (WOP-201) ([#355](https://github.com/wopr-network/wopr/issues/355)) ([33ff6bf](https://github.com/wopr-network/wopr/commit/33ff6bf48e70d3440338c662505bb45e71ecc1ba))
* instance lifecycle engine via Docker API (WOP-198) ([#350](https://github.com/wopr-network/wopr/issues/350)) ([08583d9](https://github.com/wopr-network/wopr/commit/08583d9391ff71268e02e1111510a0e09cfb7042))
* instance templates — preconfigured plugin sets for common use cases (WOP-200) ([#366](https://github.com/wopr-network/wopr/issues/366)) ([da91ecc](https://github.com/wopr-network/wopr/commit/da91eccd1c26902d0b6f8cdae2b09be5428f62fa))
* integrate Better Auth for platform auth (WOP-261) ([#342](https://github.com/wopr-network/wopr/issues/342)) ([c1a2cc4](https://github.com/wopr-network/wopr/commit/c1a2cc4c44174e66335e81342c78150e5e7d216d))
* memory system improvements ([#21](https://github.com/wopr-network/wopr/issues/21)) ([9c89a19](https://github.com/wopr-network/wopr/commit/9c89a19554f013a2992d7fa0d44e4e9e5baa3a7b))
* **metrics:** migrate metrics.sqlite to Storage API (WOP-547) ([#673](https://github.com/wopr-network/wopr/issues/673)) ([b2b9732](https://github.com/wopr-network/wopr/commit/b2b9732c5ed65990fdbee7ded9d8d5130c185a15))
* middleware and context provider management via CLI/API ([7d10bb2](https://github.com/wopr-network/wopr/commit/7d10bb205bb12c160a71bac7e8dbdbb6805e9026))
* migrate browser profiles to SQL (WOP-544) ([#674](https://github.com/wopr-network/wopr/issues/674)) ([e1d6331](https://github.com/wopr-network/wopr/commit/e1d633164a030141aa8527f9308817ac4db467ee))
* migrate crons to SQL (WOP-541) ([#666](https://github.com/wopr-network/wopr/issues/666)) ([a64df11](https://github.com/wopr-network/wopr/commit/a64df11ca48b5d4dd45834c49161d210c6115f96))
* migrate plugins.json and registries to SQL (WOP-540) ([#662](https://github.com/wopr-network/wopr/issues/662)) ([96b6ca4](https://github.com/wopr-network/wopr/commit/96b6ca4a7cd73469413e164ca959464bcbaedb96))
* migrate registries.json to Storage API (WOP-554) ([#682](https://github.com/wopr-network/wopr/issues/682)) ([ddbb8a5](https://github.com/wopr-network/wopr/commit/ddbb8a5b8d1e3dcde1c067d008b7eae7d6b4b38c))
* migrate sandbox registry to Storage API (WOP-555) ([#683](https://github.com/wopr-network/wopr/issues/683)) ([d1cb19a](https://github.com/wopr-network/wopr/commit/d1cb19a016a87e956d64594fb228375d9ddc663e))
* migrate security config to SQL (WOP-542) ([#665](https://github.com/wopr-network/wopr/issues/665)) ([a41ceb5](https://github.com/wopr-network/wopr/commit/a41ceb5d0b39b88d591dba91ccf91f7b70b6d27c))
* migrate sessions to SQL with conversation storage (WOP-539) ([#663](https://github.com/wopr-network/wopr/issues/663)) ([f9ee155](https://github.com/wopr-network/wopr/commit/f9ee1552af34e950e431d635be7f25cdad60c570))
* migrate skills state to SQL (WOP-543) ([#671](https://github.com/wopr-network/wopr/issues/671)) ([e46b193](https://github.com/wopr-network/wopr/commit/e46b193c2a1b9c6c6aba19e9a37f924af6f127bc))
* module federation UI component system for plugins ([7e6d792](https://github.com/wopr-network/wopr/commit/7e6d792fa175e1cab39cec81e0c58be9c7616745))
* multimodal support with Discord mention and image handling ([2166772](https://github.com/wopr-network/wopr/commit/2166772c3a4f837728d9d6bcc793205a1341d4bd))
* observability — structured logging, metrics, and health monitoring (WOP-197) ([#365](https://github.com/wopr-network/wopr/issues/365)) ([e2daff9](https://github.com/wopr-network/wopr/commit/e2daff9fa0599b406e15e49d0dd230f3c5039dce))
* Ollama GPU embedding service and memory sync improvements ([#13](https://github.com/wopr-network/wopr/issues/13)) ([636d1b1](https://github.com/wopr-network/wopr/commit/636d1b151fca0aea665dd741732c41a697335a3d))
* **onboard:** add external access and GitHub integration steps ([#11](https://github.com/wopr-network/wopr/issues/11)) ([444bf1a](https://github.com/wopr-network/wopr/commit/444bf1a3a7f21e2eefb4682de69763cebf4d3c74))
* onboarding wizard improvements ([#18](https://github.com/wopr-network/wopr/issues/18)) ([b32804e](https://github.com/wopr-network/wopr/commit/b32804ebf504fb88014ec3fe56d274b2edc8e5af))
* OpenAI API compatibility layer on daemon (WOP-111) ([#332](https://github.com/wopr-network/wopr/issues/332)) ([b22abf3](https://github.com/wopr-network/wopr/commit/b22abf3c6115886382a6983ed7fd52d462c06002))
* per-instance plugin management API (WOP-203) ([#351](https://github.com/wopr-network/wopr/issues/351)) ([ccfdb40](https://github.com/wopr-network/wopr/commit/ccfdb40c89349237f59ccf7fa43edc8a826b75cc))
* per-instance WOPR_HOME provisioning (WOP-199) ([#353](https://github.com/wopr-network/wopr/issues/353)) ([1320c04](https://github.com/wopr-network/wopr/commit/1320c04e498d51726ea3bb2a2a7973f083f3ece6))
* **plugins:** add JSON Schema to Zod converter for A2A tools ([5466bc5](https://github.com/wopr-network/wopr/commit/5466bc5bc3a11eff751010d07dd9c37de38a5a43))
* **plugins:** expose cancelInject to plugin context ([b7bb9f4](https://github.com/wopr-network/wopr/commit/b7bb9f484a3982577704e0e5c79fb9c2dc0707c6))
* pre-package all official plugins in Docker images (WOP-69) ([#142](https://github.com/wopr-network/wopr/issues/142)) ([f8b1474](https://github.com/wopr-network/wopr/commit/f8b14746fd5b3bef2aeb21f744f1554ddc27fade))
* priority-based middleware ordering ([598bf2e](https://github.com/wopr-network/wopr/commit/598bf2e87924bff942709803e67954886631db73))
* profile.yaml schema and compose generator (WOP-219) ([#276](https://github.com/wopr-network/wopr/issues/276)) ([94b8800](https://github.com/wopr-network/wopr/commit/94b8800c8def4b4939b872b2542a046f30b96200))
* progressive context since last trigger/mention ([386c4a7](https://github.com/wopr-network/wopr/commit/386c4a7a5b9dd7ed3ec8178583b724297bdb3aef))
* sandbox integration, P2P security source, passwordless sudo ([99d0135](https://github.com/wopr-network/wopr/commit/99d01351a48badd37cf9dea7e8fb92c8abcf1e51))
* sandbox system improvements ([#19](https://github.com/wopr-network/wopr/issues/19)) ([9540121](https://github.com/wopr-network/wopr/commit/9540121de5a7c6ee505448fdbfff3c22ebaeae25))
* security layer improvements ([#20](https://github.com/wopr-network/wopr/issues/20)) ([3d667aa](https://github.com/wopr-network/wopr/commit/3d667aacb2f7a3b91f99d36f27e8abce38780cd5))
* **security:** implement three-layer security model ([b29cc91](https://github.com/wopr-network/wopr/commit/b29cc9126608ff5121f8aa309749e2f50a2143fb))
* **skills:** Feature parity with Clawdbot skills system ([c646fb2](https://github.com/wopr-network/wopr/commit/c646fb263bd4f2cf2e76ecc30d55ba50bd01c91e))
* SQLite Hardening — pragmas, indexes, close(), JSON serialization, tests (WOP-545) ([#661](https://github.com/wopr-network/wopr/issues/661)) ([3959ecd](https://github.com/wopr-network/wopr/commit/3959ecd20fdaab972dfe2dc0f176a03ec56ec384))
* update router plugin with UI component ([604dbf8](https://github.com/wopr-network/wopr/commit/604dbf82a90e83493326bba1d53f151cf18e189c))
* voice system improvements ([#23](https://github.com/wopr-network/wopr/issues/23)) ([81614db](https://github.com/wopr-network/wopr/commit/81614db3168f666bcd65d954b3968b63ea666157))
* web search tool — multi-provider (WOP-108) ([#336](https://github.com/wopr-network/wopr/issues/336)) ([b4e121f](https://github.com/wopr-network/wopr/commit/b4e121f59c3aa67c8c7834818d32d22abe2c4007))
* WebSocket real-time status and log streaming (WOP-204) ([#335](https://github.com/wopr-network/wopr/issues/335)) ([5b1d7e7](https://github.com/wopr-network/wopr/commit/5b1d7e7caa2a3bbf650cec67ba013054f896f94f))
* wire SoulEvil config to app config in core context (WOP-106) ([#194](https://github.com/wopr-network/wopr/issues/194)) ([08d6509](https://github.com/wopr-network/wopr/commit/08d65091c2ab665163124530c04080bc8baf1f81))
* zero-downtime plugin activation with restart-on-idle (WOP-489) ([#591](https://github.com/wopr-network/wopr/issues/591)) ([8c22b34](https://github.com/wopr-network/wopr/commit/8c22b342bf4cf37fc5d72234ef2dc4acbcbf2aaa))


### Bug Fixes

* add bearer token authentication to daemon HTTP API (WOP-20) ([#79](https://github.com/wopr-network/wopr/issues/79)) ([b86ad22](https://github.com/wopr-network/wopr/commit/b86ad2281e7154a90c7d9937124648b936a7fcd7))
* add checkout step before claude-code-action ([0d9dee9](https://github.com/wopr-network/wopr/commit/0d9dee956a30986d46a58cf0d11c1b903b524d5a))
* Add close() to StorageApi interface for lifecycle consistency (WOP-580) ([#722](https://github.com/wopr-network/wopr/issues/722)) ([cc8a0a8](https://github.com/wopr-network/wopr/commit/cc8a0a8ccb8e449657853c32aa015c17620079e1))
* add missing requirements.ts, fix gitignore pattern ([1393c96](https://github.com/wopr-network/wopr/commit/1393c96bc0b06ae54a66a1b45304c2c14df2de8a))
* Add PluginInjectOptions import and update loadAllPlugins signature ([9fd6877](https://github.com/wopr-network/wopr/commit/9fd687769279174085bfdc11d6c50bc896eb1b55))
* add review prompt to Claude Code Review action ([df9ec26](https://github.com/wopr-network/wopr/commit/df9ec2656287547293c5bfdf7fca36b526a61ec3))
* address PR [#30](https://github.com/wopr-network/wopr/issues/30) review findings — timer leak, stack traces, WS data ([#33](https://github.com/wopr-network/wopr/issues/33)) ([8fb35be](https://github.com/wopr-network/wopr/commit/8fb35beaa59cb3f37015eb559957f5fd1bf2e2fa))
* address re-review findings — event de-dupe, clone cleanup ([b4dca90](https://github.com/wopr-network/wopr/commit/b4dca9072be275a778c20b9250851403da1dd639))
* address remaining review findings — events, skills, providers ([32cb17f](https://github.com/wopr-network/wopr/commit/32cb17fc2d6ad175e923b3ec0d51fe21324dc773))
* address remaining review findings — ReDoS, cron validation, path separators ([39979f9](https://github.com/wopr-network/wopr/commit/39979f951a1fed79e73507c1fdca83def581feff))
* address review feedback for core modules ([110ae22](https://github.com/wopr-network/wopr/commit/110ae22fe4d1fd10d8f5a1b6ff67636faf436f0e))
* address review findings — spawn error handling, maxBuffer ([20dbfc9](https://github.com/wopr-network/wopr/commit/20dbfc900c488971a059f5bc134fa1b392097722))
* Auto-detect available provider instead of hardcoding anthropic ([0780982](https://github.com/wopr-network/wopr/commit/0780982befbfd3dfca3a95cd55ae54f146603787))
* Auto-detect provider in inject() instead of defaulting to anthropic ([eb84fe8](https://github.com/wopr-network/wopr/commit/eb84fe8d5a0aac05e76200f69d9cd2543e10634e))
* bind daemon to 0.0.0.0 in Docker images (WOP-289, WOP-288) ([#390](https://github.com/wopr-network/wopr/issues/390)) ([fb8bd4f](https://github.com/wopr-network/wopr/commit/fb8bd4f50211205e58820f7d9ca31c37fcc27c11))
* **client:** correct skill install endpoint path ([7cd9514](https://github.com/wopr-network/wopr/commit/7cd9514aebfd4992683907ab58032e5d011ee180))
* Codex provider uses URL-based image sharing ([157b090](https://github.com/wopr-network/wopr/commit/157b0908ddd74265b0ccac29b2d03a01bd2afce5))
* command injection in cli.ts and plugins.ts (WOP-10) ([0e4e171](https://github.com/wopr-network/wopr/commit/0e4e1715983a6bfed52ca5634d88303045463868))
* command injection in cli.ts and plugins.ts (WOP-10) ([0e4e171](https://github.com/wopr-network/wopr/commit/0e4e1715983a6bfed52ca5634d88303045463868))
* command injection in installSkillFromUrl and once() listener leak ([8c02e0a](https://github.com/wopr-network/wopr/commit/8c02e0a553358b68ef22cdf998de364bd558d5e7))
* cron timeout, WebSocket validation, event bus context (WOP-15) ([#30](https://github.com/wopr-network/wopr/issues/30)) ([a90cdd9](https://github.com/wopr-network/wopr/commit/a90cdd9c40361113f87a8cd2d8ec39472c514d0b))
* eliminate all 252 biome lint warnings (noExplicitAny, noNonNullAssertion, noGlobalIsNan) ([b92e133](https://github.com/wopr-network/wopr/commit/b92e1337d4ac00d36bed650ab86bb23c34cb3fcf))
* Filter out system messages and context markers from conversation history ([560bf87](https://github.com/wopr-network/wopr/commit/560bf874a95611af75ac78428f4676335e7125dc))
* improve type safety across client, commands, and core types ([5fbf724](https://github.com/wopr-network/wopr/commit/5fbf724c401d4932601dadb9259d3ff05f52aea6))
* Join response chunks without newlines (was causing weird spacing) ([9b40221](https://github.com/wopr-network/wopr/commit/9b402210f79474c5cdfdb4dc3203874aeebc42f5))
* Load config at daemon startup before loading plugins ([6943dd8](https://github.com/wopr-network/wopr/commit/6943dd82f1976a05480d2c23f38fa1957d40c99b))
* Load memories from global identity directory ([4f5aea3](https://github.com/wopr-network/wopr/commit/4f5aea3f79d3947bda985342109c720dde00584c))
* **memory:** filter empty strings from OpenAI embeddings input ([32369a8](https://github.com/wopr-network/wopr/commit/32369a83c9a39e1bed4889c438d1848a2d2a6c32))
* MetricsStore API mismatch with Storage and test timing (WOP-577) ([#726](https://github.com/wopr-network/wopr/issues/726)) ([ed429ca](https://github.com/wopr-network/wopr/commit/ed429caca210b45e74c80d414830ceab1a5ce7e5))
* only run on PRs and [@claude](https://github.com/claude) mentions, not raw pushes ([2cabf90](https://github.com/wopr-network/wopr/commit/2cabf90dbc4d6e38511e14fec611d7264724a54c))
* Pass full PluginInjectOptions to inject() instead of just onStream callback ([938abfe](https://github.com/wopr-network/wopr/commit/938abfe2d43bb81ad475524078d32cf9f36a7d04))
* pass memory config to MemoryIndexManager ([#3](https://github.com/wopr-network/wopr/issues/3)) ([ad300fa](https://github.com/wopr-network/wopr/commit/ad300faf6d7ab0a5a572697f191f073a526139ec))
* patch npm bundled CVEs in Docker images (tar, brace-expansion) ([d5a7d42](https://github.com/wopr-network/wopr/commit/d5a7d42834645b21d1680d0380c46d33fff2be82))
* persist Claude Code sessions across container restarts ([587e2bf](https://github.com/wopr-network/wopr/commit/587e2bf2a0539ded2636f387323d816f30f4c11d))
* persist workspace in WOPR_HOME for Docker ([e91360b](https://github.com/wopr-network/wopr/commit/e91360bf39e9578376a1fc7ce3a9b67738f12095))
* **plugins:** use centralized WOPR_HOME from paths.ts ([d3b7eda](https://github.com/wopr-network/wopr/commit/d3b7eda02ab58b271e1eb4615ef9805803339145))
* re-fetch providers after health check + add logging ([420cbab](https://github.com/wopr-network/wopr/commit/420cbabf346cf5b5a9f141318c7861e2df863f05))
* remove `as any` casts from session-repository and session-migration ([f07635c](https://github.com/wopr-network/wopr/commit/f07635c0fd54656c6473138e9ac574b9a421695c))
* remove cost tracking from core inject pipeline (WOP-383) ([#480](https://github.com/wopr-network/wopr/issues/480)) ([0dec98b](https://github.com/wopr-network/wopr/commit/0dec98b523f3a7e7c6d67e01f32f84ac0b1b0add))
* remove monorepo plugins/ dir and bundled registration ([#689](https://github.com/wopr-network/wopr/issues/689)) ([b77319e](https://github.com/wopr-network/wopr/commit/b77319e6790ff2d7e2788ee93f6b77dac4eff4c7))
* remove prompt field to use tag mode (posts visible reviews) ([bf22542](https://github.com/wopr-network/wopr/commit/bf22542c26c6bced992278aa2c3f433bbcd4beef))
* remove remaining billing config from WoprConfig interface ([#654](https://github.com/wopr-network/wopr/issues/654)) ([34707f6](https://github.com/wopr-network/wopr/commit/34707f6f386566fd91d5bba0e9e46d826b257a4e))
* Remove stale test files for extracted modules (WOP-576) ([#720](https://github.com/wopr-network/wopr/issues/720)) ([abfdcd8](https://github.com/wopr-network/wopr/commit/abfdcd8ed1b86673f7cf90b9a16e7ba156e5c165))
* replace execSync/exec with spawn/spawnSync to prevent command injection (WOP-10) ([8ac2cec](https://github.com/wopr-network/wopr/commit/8ac2cecb00635d06ffd9f59ad59f41291cd4e830))
* resolve 14 lint errors in wopr core (WOP-156) ([#199](https://github.com/wopr-network/wopr/issues/199)) ([f6d828c](https://github.com/wopr-network/wopr/commit/f6d828c279bc5a876176271b031ca39639511f1b))
* resolve 72 noExplicitAny lint warnings across core modules (WOP-232) ([#328](https://github.com/wopr-network/wopr/issues/328)) ([4f06aa3](https://github.com/wopr-network/wopr/commit/4f06aa3264b2db82239c506eca4097fcf7202d51))
* resolve biome formatting and import ordering errors ([f4b8684](https://github.com/wopr-network/wopr/commit/f4b86848f9edcdd26620c36c1d98806234435425))
* resolve biome lint/format errors blocking CI ([dec1992](https://github.com/wopr-network/wopr/commit/dec19927838ba57055b2d13bf50dc8f916ad378a))
* resolve biome noBannedTypes lint errors breaking CI ([a91daab](https://github.com/wopr-network/wopr/commit/a91daab99177cff7feb4472b158f26fd3f998212))
* resolve TypeScript compilation errors ([89aea48](https://github.com/wopr-network/wopr/commit/89aea482c68abbda9e9a181ab20f09b1bd6463a8))
* Run provider health check AFTER plugins are loaded ([b7aadeb](https://github.com/wopr-network/wopr/commit/b7aadebb8a4ad000f139123db74e13a2f10ae9bf))
* security hardening — CodeQL alerts, execSync migration, ReDoS, cron validation ([#25](https://github.com/wopr-network/wopr/issues/25)) ([205632a](https://github.com/wopr-network/wopr/commit/205632a41771e1c59e7e938752e99e5df16e9014))
* security hardening across core modules ([949a046](https://github.com/wopr-network/wopr/commit/949a046bf12fc675dd464dcf6befd2416a748e7b))
* **security:** eliminate RCE in hook command execution ([#116](https://github.com/wopr-network/wopr/issues/116)) ([9e554e5](https://github.com/wopr-network/wopr/commit/9e554e5e78ecf439fce32c593d59d4e2bb78edb3))
* sequential event bus handlers + chunk UNIQUE constraint ([#17](https://github.com/wopr-network/wopr/issues/17)) ([a863cd3](https://github.com/wopr-network/wopr/commit/a863cd3123bc9159c13e9c9fdc0f7f064ef0cf43))
* **sessions:** add logging and timeout to sessions_send ([c02828a](https://github.com/wopr-network/wopr/commit/c02828a7c1512a52aa03df282ca29fd763ac89d7))
* store PKCE code verifier server-side in OAuth flow (WOP-31) ([#78](https://github.com/wopr-network/wopr/issues/78)) ([23823b4](https://github.com/wopr-network/wopr/commit/23823b446c17ee7e64d33e441934ea5f3d882a63))
* support https://github.com/ URLs in plugin install ([9c43275](https://github.com/wopr-network/wopr/commit/9c432754345a05e974793c5aa37f07f38ccc9969))
* support WOPR session format in memory indexer ([#5](https://github.com/wopr-network/wopr/issues/5)) ([6e6e408](https://github.com/wopr-network/wopr/commit/6e6e408d7c51b274df5d5a360983d2c3e6cdc9f8))
* Update loadPlugin signature to use PluginInjectOptions ([d8c79db](https://github.com/wopr-network/wopr/commit/d8c79db69a0bd56b7da1a0d8af9ca3c1f79f1021))
* use container IP for DinD smoke test (WOP-402) ([#589](https://github.com/wopr-network/wopr/issues/589)) ([bf899be](https://github.com/wopr-network/wopr/commit/bf899bed12efee322f627ce7cb9e22ff1c572679))
* use correct `prompt` input for claude-code-action ([b563155](https://github.com/wopr-network/wopr/commit/b563155adbaaadfb2d283d36d68101e6ce8070f1))
* use createRequire for node:sqlite in ESM context ([#4](https://github.com/wopr-network/wopr/issues/4)) ([4b695e6](https://github.com/wopr-network/wopr/commit/4b695e6b711937c68428aaa6527269c34e24cbeb))
* validate session name parameters in daemon HTTP routes (WOP-22) ([#85](https://github.com/wopr-network/wopr/issues/85)) ([e67cb95](https://github.com/wopr-network/wopr/commit/e67cb9525eb920357447623fb200917111ab1fb7))


### Performance

* remove node-llama-cpp and codex-sdk from core deps ([ba6a994](https://github.com/wopr-network/wopr/commit/ba6a99494afb19523330e8c41512af2f5d69c507))


### Code Refactoring

* break up oversized files in WOPR core (WOP-17) ([#35](https://github.com/wopr-network/wopr/issues/35)) ([907a21d](https://github.com/wopr-network/wopr/commit/907a21d0a86e3cb7cb4b367cfd0b19c4bdb79da5))
* change PluginCapability, PluginCategory, AdapterCapability to string (WOP-496) ([#613](https://github.com/wopr-network/wopr/issues/613)) ([3dc4726](https://github.com/wopr-network/wopr/commit/3dc47263929397285109e7cadb9d049194cb3e26))
* delete src/platform/ from core, inline into daemon (WOP-297) ([#393](https://github.com/wopr-network/wopr/issues/393)) ([645cfe6](https://github.com/wopr-network/wopr/commit/645cfe6d769dc3c1ce5ccd757c0386953b0c7ea2))
* Extract cron module from core to plugin (WOP-549) ([#684](https://github.com/wopr-network/wopr/issues/684)) ([09971ae](https://github.com/wopr-network/wopr/commit/09971ae4fb4d9e1b7750d3c64b89a167a0b8dc40))
* Extract skills module to plugin (WOP-550) ([#685](https://github.com/wopr-network/wopr/issues/685)) ([4dd143c](https://github.com/wopr-network/wopr/commit/4dd143cac0443fbb1bd178d6a0d91a330841d4b6))
* **memory:** strip embeddings, add temporal filtering, fix cron race ([#8](https://github.com/wopr-network/wopr/issues/8)) ([1a73b02](https://github.com/wopr-network/wopr/commit/1a73b0284a7185399da6cc2a39aa812fd3be8f18))
* plugin extension system, remove dead provider code ([d7c5a06](https://github.com/wopr-network/wopr/commit/d7c5a065cfd4788437c3c95c2e8c79f3864c391c))
* remove better-auth from core daemon (WOP-378) ([#500](https://github.com/wopr-network/wopr/issues/500)) ([8d94701](https://github.com/wopr-network/wopr/commit/8d94701efb069880ba85af7ffce1ec8c0b815496))
* remove billing/metering from wopr-core (WOP-521) ([#642](https://github.com/wopr-network/wopr/issues/642)) ([171570d](https://github.com/wopr-network/wopr/commit/171570d3f8678d4821c93c07334301fb922b1a3b))
* remove bot-side metering from sessions.ts (WOP-349) ([#556](https://github.com/wopr-network/wopr/issues/556)) ([bd68a98](https://github.com/wopr-network/wopr/commit/bd68a98b9b8f59353b5dd0ad24b9565fe3c88ea6))
* remove dead vector search code from core memory (WOP-249) ([#325](https://github.com/wopr-network/wopr/issues/325)) ([8c1506b](https://github.com/wopr-network/wopr/commit/8c1506b61229afdbf3eb3e297d3d6ab9eee1bf0b))
* remove fleet management from core ([7aae2b4](https://github.com/wopr-network/wopr/commit/7aae2b474165e36a8b3c4c76ed99b8157a2a00a0))
* remove P2P from core - now in plugin ([7ce8f1a](https://github.com/wopr-network/wopr/commit/7ce8f1aa0860435cabc65aa97b480d62401e86c9))
* replace console.log/warn/error with logger across src/ (WOP-150) ([#197](https://github.com/wopr-network/wopr/issues/197)) ([880fc2d](https://github.com/wopr-network/wopr/commit/880fc2d2c3ac91a04514ca38afb394e3d7f5aff6))
* **security:** composable primitives replacing gateway concept ([5615ab2](https://github.com/wopr-network/wopr/commit/5615ab2f3f531b7cb625d05ee09974d3d8b53c00))
* use epoch 0 as initial timestamp for progressive context ([678ab40](https://github.com/wopr-network/wopr/commit/678ab40f50e3332549e3f365971060f26f953ec6))
* V2 session injection, plugin system cleanup, queue simplification ([#14](https://github.com/wopr-network/wopr/issues/14)) ([27597fd](https://github.com/wopr-network/wopr/commit/27597fd9b02ec3d82f16484471919ae4d3ecdd18))


### Security

* add global error handler + upgrade claude-agent-sdk (WOP-478) ([#592](https://github.com/wopr-network/wopr/issues/592)) ([25ca013](https://github.com/wopr-network/wopr/commit/25ca01338ba685e9516d66d7594ef4437f5afd91))
* add Trivy vulnerability scanning to Docker builds (WOP-188) ([#301](https://github.com/wopr-network/wopr/issues/301)) ([6f20d23](https://github.com/wopr-network/wopr/commit/6f20d2376156710fcf60ff9f2f1f1f72f6f2cc5f))
* redact secrets from daemon config API (WOP-234) ([#326](https://github.com/wopr-network/wopr/issues/326)) ([9d99406](https://github.com/wopr-network/wopr/commit/9d994068dd058ff9559de3814d887f802bba04f6))
* remove env from exec_command allowlist (WOP-235) ([#324](https://github.com/wopr-network/wopr/issues/324)) ([16adcc5](https://github.com/wopr-network/wopr/commit/16adcc5bcb18fc2804b991f2d3b4e427a6f116aa))
* require explicit consent before executing skill install steps (WOP-148) ([#189](https://github.com/wopr-network/wopr/issues/189)) ([f46ffcb](https://github.com/wopr-network/wopr/commit/f46ffcbee5da3708c44d3bdb50ca43001b31e96a))
* show exact script content in consent prompt, not summary (WOP-250) ([#327](https://github.com/wopr-network/wopr/issues/327)) ([c008406](https://github.com/wopr-network/wopr/commit/c008406a17368f65a97d8438df22dd2d26fb9116))


### Tests

* add unit tests for core security/policy module (WOP-84) ([#113](https://github.com/wopr-network/wopr/issues/113)) ([1aebe30](https://github.com/wopr-network/wopr/commit/1aebe307131e843eabd2c1268c5b247deb7697eb))
* add unit tests for core sessions module (WOP-81) ([#110](https://github.com/wopr-network/wopr/issues/110)) ([af71682](https://github.com/wopr-network/wopr/commit/af71682f11efc5394fb344b9dc98b7651be84587))
* add unit tests for core skills module (WOP-82) ([#111](https://github.com/wopr-network/wopr/issues/111)) ([67b74f1](https://github.com/wopr-network/wopr/commit/67b74f1d065b6ada4cc5ca149204b421bdb80ce1))
* add unit tests for plugin loading, registry, and requirements (WOP-102) ([#143](https://github.com/wopr-network/wopr/issues/143)) ([b966d29](https://github.com/wopr-network/wopr/commit/b966d2952283576db497abfe15001d6bf66738f0))
* add unit tests for voice registry and provider contracts (WOP-29) ([#100](https://github.com/wopr-network/wopr/issues/100)) ([6590c6f](https://github.com/wopr-network/wopr/commit/6590c6f960ec2aee13477d3956615ea46246000f))
* Add unit tests for workspace module (WOP-83) ([#114](https://github.com/wopr-network/wopr/issues/114)) ([5ba4c7d](https://github.com/wopr-network/wopr/commit/5ba4c7d393adfc0bfc420f9d5ed83d48f8039ecd))
* add vitest infrastructure and 113 critical tests (WOP-12) ([#29](https://github.com/wopr-network/wopr/issues/29)) ([98b86ac](https://github.com/wopr-network/wopr/commit/98b86aceecbf9333b7120d27eefcde424e9529b9))
* fix 18+ test failures from Storage API migration (WOP-586) ([#725](https://github.com/wopr-network/wopr/issues/725)) ([9f09c6b](https://github.com/wopr-network/wopr/commit/9f09c6b5ea4cb7463c61c4ae381328dcf10d8c00))
* fix all remaining test failures — 0 failures on main ([#728](https://github.com/wopr-network/wopr/issues/728)) ([d1bbf82](https://github.com/wopr-network/wopr/commit/d1bbf8292b30dfcb2085ce5a83208e7f5364ff1d))
* fix security tests for Storage API migration (WOP-575) ([#727](https://github.com/wopr-network/wopr/issues/727)) ([8459398](https://github.com/wopr-network/wopr/commit/8459398dcfe14c56e5ce5858c872013b2d63f21f))


### Documentation

* Add A2A (Agent-to-Agent) documentation ([e5d553a](https://github.com/wopr-network/wopr/commit/e5d553ad724f7621c3f3c72c58ffc4ec6f227124))
* Add A2A to README features and docs index ([c4fca68](https://github.com/wopr-network/wopr/commit/c4fca685f5a8dec8d4a524f3e00cadd17022412c))
* Add comprehensive documentation suite ([d07d1f2](https://github.com/wopr-network/wopr/commit/d07d1f22e9d3d65bfc5827f824e78452470b6192))
* Add CONTRIBUTING.md and CODE_OF_CONDUCT.md ([dfab40a](https://github.com/wopr-network/wopr/commit/dfab40aa61a11854a17579fe0a717380262d8f22))
* Add nvm use and native dependencies note to CONTRIBUTING.md (WOP-573) ([#719](https://github.com/wopr-network/wopr/issues/719)) ([682d8c2](https://github.com/wopr-network/wopr/commit/682d8c22340ab7280e7e9e4bc0989336ea3b20f5))
* define v1 requirements ([a81c7c2](https://github.com/wopr-network/wopr/commit/a81c7c243d66a9711b6df87c6a79cd0cecbfb80b))
* evaluate Anthropic Tool Search for WOPR MCP tools (WOP-151) ([#196](https://github.com/wopr-network/wopr/issues/196)) ([a389bcf](https://github.com/wopr-network/wopr/commit/a389bcf09f4efbc2780d2eae38a97d352a70a161))
* evaluate MCP Apps pattern for WebUI extensibility (WOP-58) ([#279](https://github.com/wopr-network/wopr/issues/279)) ([84a03be](https://github.com/wopr-network/wopr/commit/84a03be165186886abf6c30d4c0cba13ea6ede99))
* initialize project ([25dbe4c](https://github.com/wopr-network/wopr/commit/25dbe4cc6ad6a78d4c5ca94eb02e33e84d8fb4d1))
* map existing codebase ([aca9739](https://github.com/wopr-network/wopr/commit/aca97396d0b84ebf3f4a2c2a05b73e50ca86003f))
* MCP feasibility study for WOPR plugin discovery (WOP-95) ([#193](https://github.com/wopr-network/wopr/issues/193)) ([1767f0b](https://github.com/wopr-network/wopr/commit/1767f0bbaa47d2a21fe0e0fcee00dab32438b8f1))
* Update ARCHITECTURE.md with provider system and plugin API ([64d05a9](https://github.com/wopr-network/wopr/commit/64d05a918e33df12fe96c96f6aa91982f8a03051))
* Update planning docs with new session log, multi-provider, and TypeScript plugin features ([59a71b9](https://github.com/wopr-network/wopr/commit/59a71b91b08421207f78d0e56b9f171250721fdc))
* update project vision ([435700d](https://github.com/wopr-network/wopr/commit/435700d3d19fdf80722e791b1a91be87a447ac69))
* Update README and add comprehensive plugins documentation ([e798ffc](https://github.com/wopr-network/wopr/commit/e798ffcea906a024139d3cb2721ecd9e9df0c6c0))
* Update README with new session log command and plugin features ([5d34026](https://github.com/wopr-network/wopr/commit/5d34026e379f0af8a3ea97d6e089199481cf5e51))


### Miscellaneous

* add .pnpm-store to gitignore ([d7f7447](https://github.com/wopr-network/wopr/commit/d7f74478ca397de660524f53bfc4f3e8c28ebb00))
* add dependabot config for weekly dependency updates ([1b8130a](https://github.com/wopr-network/wopr/commit/1b8130ad2b2c3024ec88c677e8377f371e730616))
* add project config ([f84053a](https://github.com/wopr-network/wopr/commit/f84053acb0b8a02506ade50d73ed9c5fbda80cfa))
* address tech debt — version fix, session timestamps, .nvmrc (WOP-18) ([#34](https://github.com/wopr-network/wopr/issues/34)) ([89ed8e8](https://github.com/wopr-network/wopr/commit/89ed8e8064fe89c60e64f3bad05e91f38790794d))
* **ci:** bump actions/checkout from 4 to 6 ([#639](https://github.com/wopr-network/wopr/issues/639)) ([4d77ad5](https://github.com/wopr-network/wopr/commit/4d77ad5f77bb56b354661871395f57a4419ef613))
* **ci:** bump actions/download-artifact from 4 to 7 ([#305](https://github.com/wopr-network/wopr/issues/305)) ([c4af31c](https://github.com/wopr-network/wopr/commit/c4af31c660de2e49739c89f17ce64d7399dfa87d))
* **ci:** bump actions/github-script from 7 to 8 ([#638](https://github.com/wopr-network/wopr/issues/638)) ([2efee81](https://github.com/wopr-network/wopr/commit/2efee81be617a585a0a4315ee908da9303b403b1))
* **ci:** bump actions/setup-node from 4 to 6 ([#307](https://github.com/wopr-network/wopr/issues/307)) ([6250121](https://github.com/wopr-network/wopr/commit/62501217ed57c52b10987e28705864d47429d6d9))
* **ci:** bump actions/upload-artifact from 4 to 6 ([#304](https://github.com/wopr-network/wopr/issues/304)) ([c8974c6](https://github.com/wopr-network/wopr/commit/c8974c6395407760c6f39ba388bc9994dd64e03f))
* **ci:** bump github/codeql-action from 3 to 4 ([#640](https://github.com/wopr-network/wopr/issues/640)) ([3a86a27](https://github.com/wopr-network/wopr/commit/3a86a2756d66af07ac5d9725ca7cbf6ac9098ed1))
* **deps:** bump @biomejs/biome from 2.3.15 to 2.4.0 ([#641](https://github.com/wopr-network/wopr/issues/641)) ([ce94cd6](https://github.com/wopr-network/wopr/commit/ce94cd611d685b901221d091b457bc39c3173526))
* **deps:** bump @clack/prompts from 0.7.0 to 1.0.0 ([#308](https://github.com/wopr-network/wopr/issues/308)) ([adff31f](https://github.com/wopr-network/wopr/commit/adff31f5a14eb85f54c54ab0fd7e71fdbda4b4e7))
* **deps:** bump @types/node to 25.2.3, vitest to 4.0.18 ([6013d0a](https://github.com/wopr-network/wopr/commit/6013d0a5c0cbc32f1440831c7cf70978cd705f59))
* enable wopr-hooks claude plugin ([#26](https://github.com/wopr-network/wopr/issues/26)) ([1bf04cc](https://github.com/wopr-network/wopr/commit/1bf04ccc8487c276e0b50bf15de017962fc409f8))
* move router plugin to separate repo ([6a98c01](https://github.com/wopr-network/wopr/commit/6a98c0198596c525018ef0a90438dda5cce45287))
* move web UI to separate plugin repository ([a144f0c](https://github.com/wopr-network/wopr/commit/a144f0c3cbaca4ad922b4ec78fc8e0ed3d4280c0))
* promote noExplicitAny and noNonNullAssertion from warn to error ([995ae23](https://github.com/wopr-network/wopr/commit/995ae236fe181168d581639e3745f7795c8bddc8))
* release v1.0.0 ([43804ed](https://github.com/wopr-network/wopr/commit/43804ed14a6461b425871c7820520629d6b9718c))
* remove duplicate discord plugin from examples ([eccba43](https://github.com/wopr-network/wopr/commit/eccba43f45be168451e81dc7fc2509c0f5707920))
* remove plugin cloning from Dockerfile ([79a16dd](https://github.com/wopr-network/wopr/commit/79a16dd90c494a7a5d5bf7590b55b51063282259))
* remove plugin cloning from Dockerfile.service ([e9b5956](https://github.com/wopr-network/wopr/commit/e9b5956a9fbd1e731e867c8f7f404c89313ab623))
* slim Dockerfile, memory schema cleanup, onboarding finalize step ([#15](https://github.com/wopr-network/wopr/issues/15)) ([35c3cb8](https://github.com/wopr-network/wopr/commit/35c3cb8a0ca6744aff1f73fa997ef40ff0ca6b92))
* tighten TypeScript and biome strictness (WOP-14) ([#32](https://github.com/wopr-network/wopr/issues/32)) ([f18ff28](https://github.com/wopr-network/wopr/commit/f18ff284aaba74302092bf6ef6b35b5e01cb6b59))
* track creation time and lastChecked in core registries (WOP-89) ([#123](https://github.com/wopr-network/wopr/issues/123)) ([6047974](https://github.com/wopr-network/wopr/commit/60479746bfb86b873878543d3754a9e2b589b8a4))
* update core dependencies (WOP-16) ([#31](https://github.com/wopr-network/wopr/issues/31)) ([0c1387b](https://github.com/wopr-network/wopr/commit/0c1387b3004bf3b7eac840699702e006096c3dd6))
* use node:lts-slim ([9df8565](https://github.com/wopr-network/wopr/commit/9df8565bc72057678779f7b62850ae48893c50ba))


### DevOps

* add Dependabot config to all repos (WOP-183) ([#329](https://github.com/wopr-network/wopr/issues/329)) ([1c98da5](https://github.com/wopr-network/wopr/commit/1c98da564c3118a8560c6316b5e881ff6f5fad7a))
* add Docker build and push workflow (WOP-187) ([#281](https://github.com/wopr-network/wopr/issues/281)) ([f31d06e](https://github.com/wopr-network/wopr/commit/f31d06efd3de99c52fde93d913a1e612577a81a7))
* add nightly stable/staging promotion workflow (WOP-218) ([#300](https://github.com/wopr-network/wopr/issues/300)) ([bc228e5](https://github.com/wopr-network/wopr/commit/bc228e55488f15b8f23e7298d62dc7ade9c04056))
* add publish.yml workflow (WOP-184) ([c40df0d](https://github.com/wopr-network/wopr/commit/c40df0de4c5d412b7fc8591d6d5b0a3a32291eab))
* add release-please for automated versioning and changelogs (WOP-185) ([#299](https://github.com/wopr-network/wopr/issues/299)) ([d8bc2a9](https://github.com/wopr-network/wopr/commit/d8bc2a9684d102e2b6061dc2691aa8c56316e38e))
* multi-arch Docker builds with Trivy gate (WOP-189) ([#302](https://github.com/wopr-network/wopr/issues/302)) ([6c93b2c](https://github.com/wopr-network/wopr/commit/6c93b2cc6571d4831fc58ac7c689336677157967))
* rename core package to @wopr-network/wopr (WOP-179) ([#265](https://github.com/wopr-network/wopr/issues/265)) ([0179d5d](https://github.com/wopr-network/wopr/commit/0179d5d08b3f332410c302556f313456c55017c5))
* switch to Node 24 Alpine for zero-vuln Docker images ([661ad97](https://github.com/wopr-network/wopr/commit/661ad9737897c9f4c90fa2c086c4c7daf0c7e27d))

## [Unreleased]

### Added
- Event bus system for reactive plugin composition
- Plugin hooks API for mutable lifecycle events
- `ctx.events` and `ctx.hooks` in plugin context
- Session lifecycle events: create, beforeInject, afterInject, responseChunk, destroy
- Channel events: message, send
- Plugin lifecycle events: beforeInit, afterInit, error
- System events: configChange, shutdown
- Comprehensive events documentation
- Plugin examples: event-monitor, session-analytics

## [1.0.0] - 2025-01-29

### Added
- **Core P2P System**
  - Ed25519/X25519 cryptographic identity
  - End-to-end encrypted messaging (AES-256-GCM)
  - Forward secrecy with ephemeral keys
  - Hyperswarm DHT-based peer discovery
  - Signed invites bound to recipient public keys
  - Key rotation with peer notification

- **AI Session Management**
  - Named persistent sessions with context
  - Multi-provider AI support (auto-detection)
  - Session resumption across restarts
  - Conversation history (JSONL format)
  - Context file support (`.md` files)

- **Plugin System**
  - Dynamic plugin loading
  - Channel adapters (Discord, Slack, Telegram, etc.)
  - Model provider plugins
  - Middleware support
  - Configuration schemas
  - Web UI extensions
  - UI components (SolidJS)

- **Official Channel Plugins**
  - Discord with reactions and threading
  - Slack with Socket Mode
  - Telegram with Grammy
  - WhatsApp with Baileys
  - Signal with signal-cli
  - iMessage (macOS only)
  - Microsoft Teams

- **Official Provider Plugins**
  - Moonshot AI Kimi
  - OpenAI
  - Anthropic Claude

- **Skills System**
  - Skill registry management
  - GitHub-based skill distribution
  - Automatic skill loading
  - Built-in skill collection

- **Scheduled Injections**
  - Cron-style scheduling
  - Natural language scheduling (`+1h`, `@daily`)
  - One-time future injections

- **Workspace Identity**
  - AGENTS.md - Agent persona
  - SOUL.md - Agent essence/values
  - USER.md - User profile
  - Automatic context injection

- **Onboarding Wizard**
  - Interactive setup (`wopr onboard`)
  - Provider configuration
  - Channel plugin setup
  - P2P networking setup

- **Discovery**
  - Topic-based peer discovery
  - Ephemeral peer advertisements
  - Profile-based filtering
  - Connection requests

- **HTTP API**
  - RESTful session management
  - Streaming injection endpoint
  - Plugin management
  - Configuration API
  - WebSocket support

- **CLI**
  - Session commands (create, inject, log, list, show, delete)
  - Identity management
  - Peer management
  - Invite system (create, claim, revoke)
  - Plugin commands (install, enable, disable, list)
  - Skill commands (registry, install, list)
  - Cron commands (add, remove, list, run)
  - Discovery commands (join, leave, peers, connect)
  - Daemon commands (start, stop, status, logs)

- **Security**
  - Rate limiting
  - Replay protection
  - Nonce validation
  - Timestamp validation
  - Comprehensive threat model

- **Documentation**
  - Architecture documentation
  - Protocol specification
  - Threat model analysis
  - Plugin development guide
  - API reference
  - Event system documentation

### Security
- Implements v2 protocol with forward secrecy
- Invites cryptographically bound to recipient
- All messages signed and encrypted
- Key rotation support

## [0.9.0] - 2024-12-15

### Added
- Initial beta release
- Basic P2P messaging
- Session management
- Plugin system foundation
- Discord plugin prototype

[Unreleased]: https://github.com/wopr-network/wopr/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wopr-network/wopr/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/wopr-network/wopr/releases/tag/v0.9.0
