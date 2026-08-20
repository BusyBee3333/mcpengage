export type ExportRequestResult = {
  status: "queued" | "ready";
  exportId: string;
  expiresAt: string;
  downloadUrl?: string;
};

export type DeleteRequestResult = {
  status: "queued" | "complete";
  deletionJobId: string;
  deleted?: number;
  completedAt?: string;
};

export interface LifecycleCoordinator {
  requestExport(tenantId: string, format: "json" | "json_csv", idempotencyKey: string): Promise<ExportRequestResult>;
  requestDeletion(tenantId: string, scope: "record" | "domain" | "account", target: string | undefined, idempotencyKey: string): Promise<DeleteRequestResult>;
}
