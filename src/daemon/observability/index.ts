/**
 * Observability module exports
 */

export {
  type HealthCheckFn,
  HealthMonitor,
  type HealthState,
  healthMonitor,
  type InstanceHealth,
  type PlatformHealth,
} from "./health.js";
export {
  _resetLogsForTesting,
  clearInstanceLogs,
  createInstanceLogger,
  type GetLogsOptions,
  getInstanceLogs,
  getLoggedInstanceIds,
  type LogLevel,
  recordLog,
  type StructuredLogEntry,
} from "./logger.js";
export {
  type InstanceMetricsSummary,
  type MetricRecord,
  MetricsStore,
  type MetricsSummary,
  metricsPluginSchema,
} from "./metrics.js";
