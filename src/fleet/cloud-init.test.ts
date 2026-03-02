import { describe, expect, it } from "vitest";
import { generateCloudInit, validateBotImage } from "./cloud-init.js";

describe("generateCloudInit", () => {
  it("starts with cloud-config directive", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result.startsWith("#cloud-config\n")).toBe(true);
  });

  it("includes docker.io package", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result).toContain("- docker.io");
  });

  it("interpolates the bot image correctly", () => {
    const image = "ghcr.io/wopr-network/wopr:v1.2.3";
    const result = generateCloudInit(image);
    expect(result).toContain(`docker pull "${image}"`);
  });

  it("includes WOPR_NODE_READY marker", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result).toContain("WOPR_NODE_READY");
  });

  it("includes systemctl enable docker", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result).toContain("systemctl enable docker");
    expect(result).toContain("systemctl start docker");
  });

  it("rejects invalid botImage with shell metacharacters", () => {
    expect(() => generateCloudInit("image; rm -rf /")).toThrow("Invalid botImage");
  });

  it("rejects botImage with backticks", () => {
    expect(() => generateCloudInit("`whoami`")).toThrow("Invalid botImage");
  });

  it("rejects botImage with spaces", () => {
    expect(() => generateCloudInit("image name")).toThrow("Invalid botImage");
  });

  it("rejects botImage with dollar sign", () => {
    expect(() => generateCloudInit("$(whoami)")).toThrow("Invalid botImage");
  });

  it("rejects botImage with newline", () => {
    expect(() => generateCloudInit("image\nruncmd:\n  - echo pwned")).toThrow("Invalid botImage");
  });

  it("rejects empty botImage", () => {
    expect(() => generateCloudInit("")).toThrow("Invalid botImage");
  });

  it("accepts image without tag", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr");
    expect(result).toContain('docker pull "ghcr.io/wopr-network/wopr"');
  });

  it("quotes botImage in docker pull command", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result).toContain('docker pull "ghcr.io/wopr-network/wopr:latest"');
  });

  it("single-quotes nodeSecret in echo command", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest", "wopr_node_test123");
    expect(result).toContain("echo 'WOPR_NODE_SECRET=wopr_node_test123'");
  });

  it("exports validateBotImage that throws on invalid input", () => {
    expect(() => validateBotImage("image; rm -rf /")).toThrow("Invalid botImage");
  });

  it("exports validateBotImage that accepts valid images", () => {
    expect(() => validateBotImage("ghcr.io/wopr-network/wopr:latest")).not.toThrow();
  });

  it("injects WOPR_NODE_SECRET env var when nodeSecret provided", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest", "wopr_node_test123");
    expect(result).toContain("WOPR_NODE_SECRET=wopr_node_test123");
  });

  it("does not inject WOPR_NODE_SECRET when not provided", () => {
    const result = generateCloudInit("ghcr.io/wopr-network/wopr:latest");
    expect(result).not.toContain("WOPR_NODE_SECRET");
  });
});
