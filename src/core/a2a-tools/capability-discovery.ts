/**
 * Capability discovery tools: capability_discover
 *
 * Generic capability registry endpoint for agents and UI surfaces.
 * Supersedes bespoke per-capability tools (WOP-268, WOP-278).
 */

import { getCapabilityRegistry } from "../capability-registry.js";
import { providerRegistry } from "../providers.js";
import { tool, withSecurityCheck, z } from "./_base.js";

export function createCapabilityDiscoveryTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "capability_discover",
      "Discover all available capabilities, their providers, and health status. Use this to find what the system can do (TTS, STT, image-gen, LLM, etc.), who provides each capability, and whether providers are healthy. Optionally filter by a specific capability type.",
      {
        capability: z
          .string()
          .optional()
          .describe(
            "Filter to a specific capability type (e.g., 'tts', 'stt', 'image-gen', 'text-gen'). Omit to list all capabilities.",
          ),
        includeHealth: z
          .boolean()
          .optional()
          .describe("Include provider health/availability status. Defaults to true."),
        includeConfigSchemas: z
          .boolean()
          .optional()
          .describe("Include config schemas for each provider (for setup/configuration). Defaults to false."),
      },
      async (args: { capability?: string; includeHealth?: boolean; includeConfigSchemas?: boolean }) => {
        return withSecurityCheck("capability_discover", sessionName, async () => {
          const capRegistry = getCapabilityRegistry();
          const includeHealth = args.includeHealth !== false;
          const includeConfigSchemas = args.includeConfigSchemas === true;

          // Build provider health lookup from ProviderRegistry
          // (model providers that have health/credential state)
          const providerHealthMap = new Map<string, { available: boolean; lastChecked: number }>();
          if (includeHealth) {
            for (const p of providerRegistry.listProviders()) {
              providerHealthMap.set(p.id, {
                available: p.available,
                lastChecked: p.lastChecked,
              });
            }
          }

          // Get capabilities from CapabilityRegistry
          const allCapabilities = capRegistry.listCapabilities();

          // Filter if requested
          const filtered = args.capability
            ? allCapabilities.filter((c) => c.capability === args.capability)
            : allCapabilities;

          // Build response
          const capabilities = filtered.map((cap) => {
            const providers = capRegistry.getProviders(cap.capability);

            const providerEntries = providers.map((p) => {
              const entry: Record<string, unknown> = {
                id: p.id,
                name: p.name,
              };

              // Include health status if available and requested
              if (includeHealth) {
                const health = providerHealthMap.get(p.id);
                if (health) {
                  entry.available = health.available;
                  entry.lastChecked = health.lastChecked;
                }
              }

              // Include config schema if requested
              if (includeConfigSchemas && p.configSchema) {
                entry.configSchema = p.configSchema;
              }

              return entry;
            });

            return {
              capability: cap.capability,
              providerCount: cap.providerCount,
              providers: providerEntries,
            };
          });

          const response: Record<string, unknown> = { capabilities };

          // If filtering by a single capability that doesn't exist, indicate that
          if (args.capability && capabilities.length === 0) {
            response.message = `No providers registered for capability: ${args.capability}`;
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, 2),
              },
            ],
          };
        });
      },
    ),
  );

  return tools;
}
