/**
 * Config tools: config_get, config_set, config_provider_defaults
 */

import { redactSensitive } from "../../security/index.js";
import { centralConfig, tool, withSecurityCheck, z } from "./_base.js";

export function createConfigTools(sessionName: string): any[] {
  const tools: any[] = [];

  tools.push(
    tool(
      "config_get",
      "Get a WOPR configuration value. Use dot notation for nested keys (e.g., 'providers.codex.model'). Sensitive values (API keys, secrets) are redacted for security.",
      {
        key: z.string().optional().describe("Config key to retrieve (dot notation). Omit to get all config."),
      },
      async (args: any) => {
        return withSecurityCheck("config_get", sessionName, async () => {
          await centralConfig.load();
          const { key } = args;

          if (key) {
            const value = centralConfig.getValue(key);
            if (value === undefined)
              return { content: [{ type: "text", text: `Config key "${key}" not found` }], isError: true };
            const redactedValue = redactSensitive(value, key);
            return { content: [{ type: "text", text: JSON.stringify({ key, value: redactedValue }, null, 2) }] };
          }
          const redactedConfig = redactSensitive(centralConfig.get());
          return { content: [{ type: "text", text: JSON.stringify(redactedConfig, null, 2) }] };
        });
      },
    ),
  );

  tools.push(
    tool(
      "config_set",
      "Set a WOPR configuration value. Use dot notation for nested keys. Changes are persisted immediately.",
      {
        key: z.string().describe("Config key to set (dot notation)"),
        value: z.string().describe("Value to set (strings, numbers, booleans, or JSON for objects)"),
      },
      async (args: any) => {
        return withSecurityCheck("config_set", sessionName, async () => {
          const { key, value } = args;
          await centralConfig.load();
          let parsedValue: any = value;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            /* keep as string */
          }
          centralConfig.setValue(key, parsedValue);
          await centralConfig.save();
          const redactedValue = redactSensitive(parsedValue, key);
          return { content: [{ type: "text", text: `Config set: ${key} = ${JSON.stringify(redactedValue)}` }] };
        });
      },
    ),
  );

  tools.push(
    tool(
      "config_provider_defaults",
      "Get or set default settings for a provider.",
      {
        provider: z.string().describe("Provider ID (e.g., 'codex', 'anthropic')"),
        model: z.string().optional().describe("Default model for this provider"),
        reasoningEffort: z.string().optional().describe("For Codex: minimal/low/medium/high/xhigh"),
      },
      async (args: any) => {
        const { provider, model, reasoningEffort } = args;
        await centralConfig.load();
        if (!model && !reasoningEffort) {
          const defaults = centralConfig.getProviderDefaults(provider);
          if (!defaults || Object.keys(defaults).length === 0)
            return { content: [{ type: "text", text: `No defaults set for provider '${provider}'` }] };
          return { content: [{ type: "text", text: JSON.stringify({ provider, defaults }, null, 2) }] };
        }
        if (model) centralConfig.setProviderDefault(provider, "model", model);
        if (reasoningEffort) centralConfig.setProviderDefault(provider, "reasoningEffort", reasoningEffort);
        await centralConfig.save();
        const updated = centralConfig.getProviderDefaults(provider);
        return { content: [{ type: "text", text: `Provider defaults updated:\n${JSON.stringify(updated, null, 2)}` }] };
      },
    ),
  );

  return tools;
}
