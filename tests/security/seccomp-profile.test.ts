import { describe, expect, it } from "vitest";
import { generateSeccompProfile } from "../../src/security/sandbox.js";

describe("generateSeccompProfile", () => {
  it("returns valid JSON", () => {
    const raw = generateSeccompProfile();
    const profile = JSON.parse(raw);
    expect(profile).toEqual(
      expect.objectContaining({
        defaultAction: "SCMP_ACT_ERRNO",
        architectures: expect.arrayContaining([expect.any(String)]),
        syscalls: expect.arrayContaining([
          expect.objectContaining({ action: "SCMP_ACT_ALLOW" }),
        ]),
      }),
    );
  });

  it("uses SCMP_ACT_ERRNO as defaultAction (default-deny)", () => {
    const profile = JSON.parse(generateSeccompProfile());
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
  });

  it("has exactly one syscall rule with SCMP_ACT_ALLOW", () => {
    const profile = JSON.parse(generateSeccompProfile());
    expect(profile.syscalls).toHaveLength(1);
    expect(profile.syscalls[0].action).toBe("SCMP_ACT_ALLOW");
  });

  it("allowlists read, write, open, close, mmap", () => {
    const profile = JSON.parse(generateSeccompProfile());
    const allowed = profile.syscalls[0].names as string[];
    for (const name of ["read", "write", "open", "close", "mmap"]) {
      expect(allowed).toContain(name);
    }
  });

  it("allowlists networking syscalls needed by Node.js", () => {
    const profile = JSON.parse(generateSeccompProfile());
    const allowed = profile.syscalls[0].names as string[];
    for (const name of ["socket", "connect", "bind", "listen", "accept", "accept4", "sendto", "recvfrom", "sendmsg", "recvmsg"]) {
      expect(allowed).toContain(name);
    }
  });

  it("allowlists epoll syscalls needed by libuv", () => {
    const profile = JSON.parse(generateSeccompProfile());
    const allowed = profile.syscalls[0].names as string[];
    for (const name of ["epoll_create1", "epoll_ctl", "epoll_wait", "epoll_pwait"]) {
      expect(allowed).toContain(name);
    }
  });

  it("does NOT allowlist dangerous syscalls", () => {
    const profile = JSON.parse(generateSeccompProfile());
    const allowed = profile.syscalls[0].names as string[];
    for (const name of [
      "ptrace", "bpf", "keyctl", "perf_event_open", "userfaultfd",
      "kexec_load", "kexec_file_load", "init_module", "finit_module",
      "delete_module", "mount", "umount", "umount2", "pivot_root",
      "reboot", "sethostname", "setdomainname", "acct", "swapon",
      "swapoff", "nfsservctl", "personality", "mbind", "set_mempolicy",
      "get_mempolicy", "move_pages", "migrate_pages", "io_uring_setup",
      "io_uring_enter", "io_uring_register",
    ]) {
      expect(allowed, `${name} must NOT be in the allowlist`).not.toContain(name);
    }
  });

  it("does NOT allowlist process creation syscalls", () => {
    const profile = JSON.parse(generateSeccompProfile());
    const allowed = profile.syscalls[0].names as string[];
    for (const name of ["clone", "clone3", "fork", "vfork", "execve", "execveat"]) {
      expect(allowed, `${name} must NOT be in the allowlist`).not.toContain(name);
    }
  });

  it("includes architectures field for x86_64", () => {
    const profile = JSON.parse(generateSeccompProfile());
    expect(profile.architectures).toContain("SCMP_ARCH_X86_64");
    expect(profile.architectures).toContain("SCMP_ARCH_X86");
    expect(profile.architectures).toContain("SCMP_ARCH_X32");
  });
});
