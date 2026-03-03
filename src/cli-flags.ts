import { homedir } from "node:os";
import { resolve } from "node:path";

export interface GlobalFlags {
  configPath: string | undefined;
  remainingArgs: string[];
}

export function parseGlobalFlags(args: string[]): GlobalFlags {
  let configPath: string | undefined;
  const remainingArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("--config requires a file path argument");
      }
      configPath = resolve(next.replace(/^~/, homedir()));
      i++;
    } else {
      remainingArgs.push(args[i]);
    }
  }
  return { configPath, remainingArgs };
}
