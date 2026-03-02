import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

export default logger;

/**
 * Returns true when full stack traces should be included in log output.
 * Stacks are logged when NODE_ENV is not "production" OR LOG_LEVEL is "debug".
 */
export function shouldLogStack(): boolean {
  const env = process.env.NODE_ENV;
  const level = process.env.LOG_LEVEL;
  return env !== "production" || level === "debug";
}
