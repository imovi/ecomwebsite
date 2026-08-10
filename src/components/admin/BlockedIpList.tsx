"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatDateTime } from "@/lib/utils";
import { toast } from "@/lib/stores/toast-store";
import type { ApiBlockedIp } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";

/**
 * Every address the shop has ever refused.
 *
 * WHY THIS PAGE HAS TO EXIST
 * --------------------------
 * Blocking happens on an order, which is the right place for it — that is
 * where the evidence is. But an order can be trashed, or simply lost among
 * thousands, and then the block has no door. Without a list, "block" is a
 * one-way operation, which is the wrong shape for a control that in this
 * country will sometimes catch an innocent carrier address.
 *
 * Lifted and expired blocks stay on the list rather than disappearing. They
 * are the audit trail for a block someone disputes, and they are how the owner
 * finds an address they half-remember refusing.
 */
export function BlockedIpList() {
  const [blocks, setBlocks] = useState<ApiBlockedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { blocks: rows } = await adminApi.get<{ blocks: ApiBlockedIp[] }>("admin/ips");
      setBlocks(rows);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not load the blocked addresses.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  async function unblock(id: string): Promise<void> {
    setBusy(true);
    try {
      await adminApi.delete(`admin/ips/${id}`);
      toast("Address unblocked");
      await load();
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Could not unblock that address.", {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  const active = blocks.filter((block) => block.active);
  const past = blocks.filter((block) => !block.active);

  return (
    <AdminShell title="Blocked addresses">
      <PageBody>
        <AsyncState loading={loading} error={error} onRetry={load}>
          <Card>
            <CardHeader title={`In force (${active.length})`} />
            {active.length === 0 ? (
              <p className="p-4 text-caption text-muted">
                No addresses are being refused. Orders from every address are accepted.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {active.map((block) => (
                  <li key={block.id} className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="tnum text-body font-medium text-ink">{block.ip}</span>
                      <Button
                        type="button"
                        variant="soft"
                        size="sm"
                        disabled={busy}
                        onClick={() => void unblock(block.id)}
                      >
                        Unblock
                      </Button>
                    </div>

                    {block.reason && (
                      <p className="text-caption text-ink-soft">{block.reason}</p>
                    )}

                    <p className="text-micro text-muted">
                      Blocked {formatDateTime(block.createdAt)}
                      {block.expiresAt
                        ? ` · lifts itself ${formatDateTime(block.expiresAt)}`
                        : " · permanent"}
                      {/* The number that says whether this block is working or
                          overreaching. A count far beyond what one fraudster
                          could produce means it is catching a shared carrier
                          address, and real customers with it. */}
                      {block.hitCount > 0
                        ? ` · refused ${block.hitCount} ${
                            block.hitCount === 1 ? "order" : "orders"
                          }`
                        : " · nothing refused yet"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {past.length > 0 && (
            <Card>
              <CardHeader title={`Lifted and expired (${past.length})`} />
              <ul className="divide-y divide-line">
                {past.map((block) => (
                  <li key={block.id} className="flex flex-col gap-1 p-4">
                    <span className="tnum text-caption font-medium text-ink-soft">{block.ip}</span>
                    {block.reason && <p className="text-caption text-muted">{block.reason}</p>}
                    <p className="text-micro text-muted">
                      {block.unblockedAt
                        ? `Unblocked ${formatDateTime(block.unblockedAt)}`
                        : `Expired ${block.expiresAt ? formatDateTime(block.expiresAt) : ""}`}
                      {block.hitCount > 0 ? ` · refused ${block.hitCount} while in force` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}
