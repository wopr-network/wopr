const { getSecurityRegistry } = await import("../../src/security/registry.js");

export function registerHttpAndExec() {
  const reg = getSecurityRegistry();
  reg.registerPermission("inject.network", "__test__");
  reg.registerPermission("inject.exec", "__test__");
  reg.registerToolCapability("http_fetch", "inject.network", "__test__");
  reg.registerToolCapability("exec_command", "inject.exec", "__test__");
}
