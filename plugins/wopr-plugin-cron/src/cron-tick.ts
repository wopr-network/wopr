import type { WOPRPluginContext } from "../../../src/types.js";
import type { CronScriptResult } from "../../../src/types.js";
import { getCrons, addCronRun, removeCron } from "./cron-repository.js";
import { shouldRunCron, executeCronScripts, resolveScriptTemplates } from "./cron.js";

const CRON_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per cron job

export function createCronTickLoop(ctx: WOPRPluginContext): () => Promise<void> {
  const lastRun: Record<string, number> = {};

  return async () => {
    const now = new Date();
    const nowTs = now.getTime();
    const crons = await getCrons();
    const toRemove: string[] = [];

    for (const cron of crons) {
      const key = cron.name;
      let shouldExecute = false;

      if (cron.runAt) {
        if (nowTs >= cron.runAt && !lastRun[key]) shouldExecute = true;
      } else {
        const lastMinute = lastRun[key] || 0;
        const currentMinute = Math.floor(nowTs / 60000);
        if (currentMinute > lastMinute && shouldRunCron(cron.schedule, now)) shouldExecute = true;
      }

      if (shouldExecute) {
        lastRun[key] = Math.floor(nowTs / 60000);
        ctx.log.info(`Running cron: ${cron.name} -> ${cron.session}`);
        const startTime = Date.now();
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          let resolvedMessage = cron.message;
          let scriptResults: CronScriptResult[] | undefined;
          if (cron.scripts && cron.scripts.length > 0) {
            // Check cronScriptsEnabled from main config
            const cfg = ctx.getMainConfig("daemon") as { cronScriptsEnabled?: boolean } | undefined;
            if (!cfg?.cronScriptsEnabled) {
              ctx.log.info(`Cron scripts disabled for ${cron.name}`);
            } else {
              ctx.log.info(`Executing ${cron.scripts.length} script(s) for ${cron.name}`);
              scriptResults = await executeCronScripts(cron.scripts);
              resolvedMessage = resolveScriptTemplates(cron.message, scriptResults);
              const failedScripts = scriptResults.filter((r) => r.error);
              if (failedScripts.length > 0) {
                ctx.log.warn(`${failedScripts.length} script(s) failed for ${cron.name}`);
              }
            }
          }

          await Promise.race([
            ctx.inject(cron.session, resolvedMessage, { from: "cron", silent: true }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Cron job '${cron.name}' timed out after ${CRON_TIMEOUT_MS / 1000}s`)),
                CRON_TIMEOUT_MS,
              );
            }),
          ]);
          const durationMs = Date.now() - startTime;
          ctx.log.info(`Completed: ${cron.name} (${durationMs}ms)`);

          await addCronRun({
            cronName: cron.name,
            session: cron.session,
            startedAt: startTime,
            status: "success",
            durationMs,
            message: resolvedMessage,
            scriptResults,
          });

          if (cron.once) {
            toRemove.push(cron.name);
            ctx.log.info(`Auto-removed one-time job: ${cron.name}`);
          }
        } catch (err) {
          const durationMs = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : String(err);
          ctx.log.error(`Cron error: ${cron.name} - ${errorMsg}`);

          await addCronRun({
            cronName: cron.name,
            session: cron.session,
            startedAt: startTime,
            status: "failure",
            durationMs,
            error: errorMsg,
            message: cron.message,
          });
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      }
    }

    if (toRemove.length > 0) {
      for (const name of toRemove) {
        await removeCron(name);
      }
    }
  };
}
