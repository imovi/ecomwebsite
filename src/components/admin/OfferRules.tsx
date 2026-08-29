"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { AsyncState, Card, CardHeader, ErrorBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import type { ApiStoreSettings } from "@/lib/api/types";

/**
 * The two rules behind the free-delivery offer.
 *
 * Here rather than on the Settings page, and that is the point of this whole
 * screen: an owner deciding whether an offer is worth making is looking at the
 * baskets and the report on the tabs beside this, not at courier credentials
 * and SEO fields. Settings holds what every order obeys; this holds what one
 * offer costs.
 */
export function OfferRules() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [minCart, setMinCart] = useState("");
  const [hours, setHours] = useState("");
  const [charges, setCharges] = useState<{ inside: number; outside: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ settings: ApiStoreSettings }>("admin/settings");
      setMinCart(String(data.settings.recovery.couponMinCartValue));
      setHours(String(data.settings.recovery.couponHours));
      setCharges({
        inside: data.settings.delivery.insideDhaka,
        outside: data.settings.delivery.outsideDhaka,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.patch("admin/settings", {
        recovery: { couponMinCartValue: Number(minCart), couponHours: Number(hours) },
      });
      toast("Offer rules saved");
      await load();
    } catch (caught) {
      setSaveError(caught instanceof AdminApiError ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Offer rules"
        hint="What the free-delivery offer costs, and how long a customer has to use it"
      />

      <div className="p-4 pt-0">
        <AsyncState loading={loading} error={error} onRetry={() => void load()}>
          <ErrorBanner message={saveError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Smallest basket worth an offer (৳)"
              type="number"
              min={0}
              step={1}
              value={minCart}
              onChange={(event) => setMinCart(event.target.value)}
              hint="0 for no floor."
            />
            <Input
              label="Offer lasts (hours)"
              type="number"
              min={1}
              max={720}
              step={1}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              hint="Between 1 hour and 30 days."
            />
          </div>

          {/* Said in money rather than left as a principle. The offer costs a
              fixed amount whatever the basket is worth, so on a small one it
              eats most of the margin — and the owner is the only person who
              knows where that line is for these goods. */}
          {charges && (
            <p className="mt-4 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
              Each offer used costs you {formatTaka(charges.inside)} inside Dhaka and{" "}
              {formatTaka(charges.outside)} outside it — the delivery you stop charging for.
              On a {formatTaka(300)} basket that is most of the margin; on a{" "}
              {formatTaka(2000)} one it is small. The floor above is where you draw that line.
            </p>
          )}

          <p className="mt-3 text-caption text-muted">
            The deadline is what makes the offer work. A code with no end is a discount, and a
            customer who can use it whenever has no reason to use it today.
          </p>

          <div className="mt-4">
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </AsyncState>
      </div>
    </Card>
  );
}
