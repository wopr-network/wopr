import type { Severity } from "./severity.js";

export interface EscalationContact {
  role: string;
  channel: string; // "slack" | "pagerduty" | "email" | "phone"
  target: string;
  slaMinutes: number;
  order: number;
}

/** Read escalation targets from env vars, falling back to defaults. */
function targets() {
  return {
    pagerduty: process.env.ESCALATION_PAGERDUTY_SERVICE ?? "on-call-eng",
    slack: process.env.ESCALATION_SLACK_CHANNEL ?? "#billing-incidents",
    ctoPhone: process.env.ESCALATION_CTO_PHONE ?? "cto-oncall",
    ctoEmail: process.env.ESCALATION_CTO_EMAIL ?? "cto@wopr.network",
  };
}

function buildSev1(): EscalationContact[] {
  const t = targets();
  return [
    { order: 1, role: "on-call-engineer", channel: "pagerduty", target: t.pagerduty, slaMinutes: 5 },
    { order: 2, role: "engineering-lead", channel: "slack", target: t.slack, slaMinutes: 10 },
    { order: 3, role: "incident-commander", channel: "slack", target: t.slack, slaMinutes: 15 },
    { order: 4, role: "cto", channel: "phone", target: t.ctoPhone, slaMinutes: 30 },
  ];
}

function buildSev2(): EscalationContact[] {
  const t = targets();
  return [
    { order: 1, role: "on-call-engineer", channel: "slack", target: t.slack, slaMinutes: 15 },
    { order: 2, role: "engineering-lead", channel: "slack", target: t.slack, slaMinutes: 60 },
    { order: 3, role: "cto", channel: "email", target: t.ctoEmail, slaMinutes: 240 },
  ];
}

function buildSev3(): EscalationContact[] {
  const t = targets();
  return [
    { order: 1, role: "on-call-engineer", channel: "slack", target: t.slack, slaMinutes: 60 },
    { order: 2, role: "engineering-lead", channel: "slack", target: t.slack, slaMinutes: 240 },
  ];
}

export function getEscalationMatrix(severity: Severity): EscalationContact[] {
  switch (severity) {
    case "SEV1":
      return buildSev1();
    case "SEV2":
      return buildSev2();
    case "SEV3":
      return buildSev3();
  }
}
