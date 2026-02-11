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
/**
 * Setup flow type — tells the platform how to render the input UX
 * for a particular config field. Extractable from the manifest
 * WITHOUT calling init().
 *
 * - "paste"        — User pastes a token/key (default for password/text fields)
 * - "oauth"        — Platform launches an OAuth flow and stores the resulting token
 * - "qr"           — Platform displays a QR code the user scans (e.g., WhatsApp Web)
 * - "interactive"  — Plugin provides its own multi-step UX via a setup callback
 * - "none"         — No user input needed; value is auto-derived or has a default
 */
export type SetupFlowType = "paste" | "oauth" | "qr" | "interactive" | "none";

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
  /**
   * How the platform should collect this field's value.
   * Defaults to "paste" for text/password, "none" for fields with defaults.
   */
  setupFlow?: SetupFlowType;
  /** For "oauth" setupFlow: the OAuth provider identifier (e.g., "discord", "slack") */
  oauthProvider?: string;
  /** Validation pattern (regex string) applied client-side before submit */
  pattern?: string;
  /** Human-readable validation error message */
  patternError?: string;
  /** Whether this field contains a secret (masks in UI, encrypted at rest) */
  secret?: boolean;
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
