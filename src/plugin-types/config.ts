/**
 * Canonical configuration types for WOPR plugins.
 *
 * ConfigField.type is extended to include "array", "boolean", and "object"
 * which plugins are already using in the wild. This is the canonical source
 * of truth — plugins should import from here, not define their own.
 */

/**
 * A single configuration field definition for plugin config UIs.
 *
 * The `type` union covers all field types that plugins actually use,
 * including "array", "boolean", and "object" which were previously
 * missing from the core definition.
 */
export interface ConfigField {
  name: string;
  type: "text" | "password" | "select" | "checkbox" | "number" | "array" | "boolean" | "object" | "textarea";
  label: string;
  placeholder?: string;
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[]; // For select type
  description?: string;
  /** For array type: schema of each item */
  items?: ConfigField;
  /** For object type: nested fields */
  fields?: ConfigField[];
}

/**
 * A configuration schema describing a plugin's configurable settings.
 * Used to render configuration UIs dynamically.
 */
export interface ConfigSchema {
  title: string;
  description?: string;
  fields: ConfigField[];
}
