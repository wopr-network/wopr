/**
 * Template Engine — applies instance templates to generate configurations (WOP-200)
 *
 * The applyTemplate function takes an instance ID and a template name,
 * validates the template exists, and returns the generated configuration
 * along with the list of plugins to install and providers to configure.
 */

import { getTemplate } from "./templates.js";

export interface TemplateApplicationResult {
  instanceId: string;
  templateName: string;
  config: Record<string, unknown>;
  pluginsToInstall: string[];
  providersToSetup: string[];
}

/**
 * Apply a template to an instance. Generates a config object from the template
 * and returns the list of plugins and providers that need to be installed/configured.
 *
 * @param instanceId - The target instance identifier
 * @param templateName - The name of the template to apply
 * @returns The generated configuration and required plugin/provider lists
 * @throws If the template is not found
 */
export function applyTemplate(instanceId: string, templateName: string): TemplateApplicationResult {
  const template = getTemplate(templateName);
  if (!template) {
    throw new Error(`Template "${templateName}" not found`);
  }

  const config: Record<string, unknown> = {
    ...template.config,
    instanceId,
    templateName: template.name,
    plugins: {
      data: Object.fromEntries(template.plugins.map((p) => [p, {}])),
    },
    providers: {
      data: Object.fromEntries(template.providers.map((p) => [p, {}])),
    },
  };

  return {
    instanceId,
    templateName: template.name,
    config,
    pluginsToInstall: [...template.plugins],
    providersToSetup: [...template.providers],
  };
}
