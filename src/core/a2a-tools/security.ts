/**
 * Security introspection tools: security_whoami, security_check
 */

import type { Capability } from "../../security/types.js";
import { getContext, tool, z } from "./_base.js";

export function createSecurityTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "security_whoami",
      "Get your current security context including trust level, capabilities, and sandbox status. Use this to understand what actions are available to you.",
      {},
      async () => {
        const context = getContext(sessionName);
        if (!context) {
          // Informational response only -- not used for permission decisions.
          // Legacy mode (no security context) reports owner-level for transparency.
          // Permission gates in sandbox.ts and memory.ts default to "untrusted", not "owner".
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    warning: "No security context found (legacy mode)",
                    trustLevel: "owner",
                    capabilities: ["*"],
                    sandbox: { enabled: false },
                    session: sessionName,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const policy = context.getResolvedPolicy();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  session: sessionName,
                  source: {
                    type: context.source.type,
                    trustLevel: context.source.trustLevel,
                    identity: context.source.identity,
                  },
                  capabilities: policy.capabilities,
                  allowedTools: policy.tools.allow,
                  deniedTools: policy.tools.deny,
                  sandbox: { enabled: policy.sandbox.enabled, network: policy.sandbox.network },
                  isGateway: policy.isGateway,
                  canForward: policy.canForward,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );

  tools.push(
    tool(
      "security_check",
      "Check if a specific tool or capability is allowed before attempting to use it.",
      {
        tool: z.string().optional().describe("Tool name to check (e.g., 'http_fetch', 'exec_command')"),
        capability: z.string().optional().describe("Capability to check (e.g., 'inject.network', 'cross.inject')"),
      },
      async (args: { tool?: string; capability?: string }) => {
        const { tool: toolName, capability } = args;
        const context = getContext(sessionName);
        if (!context) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ allowed: true, reason: "No security context available" }, null, 2),
              },
            ],
          };
        }
        if (toolName) {
          const check = context.canUseTool(toolName);
          return { content: [{ type: "text", text: JSON.stringify({ tool: toolName, ...check }, null, 2) }] };
        }
        if (capability) {
          const allowed = context.hasCapability(capability as Capability);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ capability, allowed, trustLevel: context.source.trustLevel }, null, 2),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: "Provide 'tool' or 'capability' to check" }], isError: true };
      },
    ),
  );

  return tools;
}
