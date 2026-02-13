/**
 * `wopr acp` command — starts the ACP stdio server for IDE integration.
 *
 * Connects to the running WOPR daemon and bridges ACP protocol messages
 * to WOPR's session/inject pipeline.
 */
import { AcpServer, type AcpSessionBridge } from "../core/acp/server.js";
import { logger } from "../logger.js";
import type { StreamMessage } from "../types.js";
import { client } from "./shared.js";

export async function acpCommand(args: string[]): Promise<void> {
  const sessionArg = args.find((a) => !a.startsWith("--"));
  const defaultSession = sessionArg ?? "acp";

  // Verify daemon is running
  const running = await client.isRunning();
  if (!running) {
    logger.error("Daemon not running. Start it: wopr daemon start");
    process.exit(1);
  }

  // Bridge ACP to the WOPR daemon via HTTP client
  const bridge: AcpSessionBridge = {
    async inject(session, message, options) {
      let response = "";
      let sessionId = "";
      let cost = 0;
      const chunks: string[] = [];

      const streamCb = options?.onStream;

      const result = await client.inject(session, message, (msg: StreamMessage) => {
        if (msg.type === "text") {
          chunks.push(msg.content);
          if (streamCb) streamCb({ type: "text", content: msg.content });
        } else if (msg.type === "complete") {
          const data = msg as StreamMessage & { sessionId?: string; cost?: number };
          sessionId = data.sessionId ?? "";
          cost = data.cost ?? 0;
        }
      });

      response = result.response || chunks.join("");
      sessionId = result.sessionId || sessionId;
      cost = result.cost || cost;

      return { response, sessionId, cost };
    },

    cancelInject(_session: string): boolean {
      // Cancel not directly supported via HTTP client; return false
      return false;
    },
  };

  const server = new AcpServer({ bridge, defaultSession });

  // Graceful shutdown on signals
  const shutdown = () => {
    logger.info("[acp] Shutting down...");
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.start();
}
