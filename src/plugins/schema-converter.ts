/**
 * JSON Schema to Zod converter and A2A server registration.
 *
 * Used when plugins register A2A tools with JSON Schema definitions
 * that need to be converted to Zod for the a2a-mcp system.
 */

import { z } from "zod";
import { registerA2ATool } from "../core/a2a-mcp.js";
import { logger } from "../logger.js";
import type { A2AServerConfig } from "../types.js";

/**
 * Convert a JSON Schema object to a Zod schema.
 * Handles basic types: string, number, boolean, array, object.
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  const type = schema.type as string;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) || [];
  const items = schema.items as Record<string, unknown> | undefined;
  const description = schema.description as string | undefined;

  let zodSchema: z.ZodTypeAny;

  switch (type) {
    case "string":
      zodSchema = z.string();
      break;
    case "number":
    case "integer":
      zodSchema = z.number();
      break;
    case "boolean":
      zodSchema = z.boolean();
      break;
    case "array":
      zodSchema = items ? z.array(jsonSchemaToZod(items)) : z.array(z.any());
      break;
    case "object":
      if (properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, propSchema] of Object.entries(properties)) {
          let prop = jsonSchemaToZod(propSchema);
          // Add description if present
          const propDesc = propSchema.description as string | undefined;
          if (propDesc) {
            prop = prop.describe(propDesc);
          }
          // Make optional if not in required array
          if (!required.includes(key)) {
            prop = prop.optional();
          }
          shape[key] = prop;
        }
        zodSchema = z.object(shape);
      } else {
        zodSchema = z.record(z.string(), z.any());
      }
      break;
    default:
      zodSchema = z.any();
  }

  if (description) {
    zodSchema = zodSchema.describe(description);
  }

  return zodSchema;
}

/**
 * Register an A2A server with multiple tools.
 * Converts A2AToolDefinition to RegisteredTool format.
 */
export function registerA2AServerImpl(config: A2AServerConfig): void {
  logger.info(`[plugins] Registering A2A server: ${config.name} (${config.tools.length} tools)`);

  for (const tool of config.tools) {
    try {
      // Convert JSON Schema to Zod
      const zodSchema = jsonSchemaToZod(tool.inputSchema) as z.ZodObject<any>;

      // Register with a2a-mcp
      registerA2ATool({
        name: tool.name,
        description: tool.description,
        schema: zodSchema,
        handler: async (args, _context) => {
          // Call the plugin's handler
          const result = await tool.handler(args);
          return result;
        },
      });

      logger.info(`[plugins]   registered A2A tool: ${tool.name}`);
    } catch (err) {
      logger.error(`[plugins]   failed to register A2A tool ${tool.name}:`, err);
    }
  }
}
