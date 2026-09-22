import type { ReportData } from "../types.js";

export function buildJsonReport(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}
