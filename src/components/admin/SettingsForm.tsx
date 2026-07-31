"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";

/**
 * Store settings.
 *
 * Delivery charges are the commercially significant field here: they are read
 * by the checkout quote endpoint on every pricing request, so a change takes
 * effect on the next quote — including for a customer part-way through
 * checkout. That is intentional (a stale charge would be collected at the door
 * by a rider who was told a different number) but worth stating.
 *
 * The API restricts writing to `admin` and above, so a manager sees the values
 * and gets a clear 403 on save rather than a silent no-op.
 */
export function SettingsForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    insideDhaka: "",
    outsideDhaka: "",
    freeDeliveryThreshold: "",
    minimumOrderValue: "",
    maxQuantityPerItem: "",
    courierInsideDhaka: "",
    courierOutsideDhaka: "",
    packagingPerOrder: "",
    returnPerOrder: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    invoiceFooter: "",
  });

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setForm({
      insideDhaka: String(data.delivery.insideDhaka),
      outsideDhaka: String(data.delivery.outsideDhaka),
      freeDeliveryThreshold: String(data.delivery.freeDeliveryThreshold),
      minimumOrderValue: String(data.ordering.minimumOrderValue),
      maxQuantityPerItem: String(data.ordering.maxQuantityPerItem),
      courierInsideDhaka: String(data.costs.courierInsideDhaka),
      courierOutsideDhaka: String(data.costs.courierOutsideDhaka),
      packagingPerOrder: String(data.costs.packagingPerOrder),
      returnPerOrder: String(data.costs.returnPerOrder),
      name: data.store.name,
      phone: data.store.phone,
      email: data.store.email,
      address: data.store.address,
      invoiceFooter: data.store.invoiceFooter,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.get<{ settings: ApiStoreSettings }>("admin/settings");
      hydrate(data.settings);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        delivery: {
          insideDhaka: Number(form.insideDhaka),
          outsideDhaka: Number(form.outsideDhaka),
          freeDeliveryThreshold: Number(form.freeDeliveryThreshold),
        },
        ordering: {
          minimumOrderValue: Number(form.minimumOrderValue),
          maxQuantityPerItem: Number(form.maxQuantityPerItem),
        },
        costs: {
          courierInsideDhaka: Number(form.courierInsideDhaka),
          courierOutsideDhaka: Number(form.courierOutsideDhaka),
          packagingPerOrder: Number(form.packagingPerOrder),
          returnPerOrder: Number(form.returnPerOrder),
        },
        store: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          invoiceFooter: form.invoiceFooter.trim(),
        },
      });
      hydrate(data.settings);
      toast("Settings saved");
    } catch (caught) {
      setSaveError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Your account can view settings but not change them. Ask an owner account."
            : caught.message
          : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Settings">
      <PageBody>
        <AsyncState loading={loading} error={error} onRetry={() => void load()}>
          {settings && (
            <>
              <ErrorBanner message={saveError} />

              <Card>
                <CardHeader
                  title="Delivery charges"
                  hint="Applied at checkout based on the area the customer enters."
                />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Inside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.insideDhaka}
                    onChange={(event) => set("insideDhaka", event.target.value)}
                  />
                  <Input
                    label="Outside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.outsideDhaka}
                    onChange={(event) => set("outsideDhaka", event.target.value)}
                  />
                  <Input
                    label="Free delivery above (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.freeDeliveryThreshold}
                    onChange={(event) => set("freeDeliveryThreshold", event.target.value)}
                    hint="0 turns free delivery off."
                    wrapperClassName="sm:col-span-2"
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="What an order costs you"
                  hint="Used by the profit page and nowhere else. Customers never see these."
                />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Courier, inside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.courierInsideDhaka}
                    onChange={(event) => set("courierInsideDhaka", event.target.value)}
                    hint="What the courier bills you — not what you charge the customer."
                  />
                  <Input
                    label="Courier, outside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.courierOutsideDhaka}
                    onChange={(event) => set("courierOutsideDhaka", event.target.value)}
                  />
                  <Input
                    label="Packaging per parcel (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.packagingPerOrder}
                    onChange={(event) => set("packagingPerOrder", event.target.value)}
                    hint="Box, tape, bubble wrap, printed invoice."
                  />
                  <Input
                    label="Cost of a returned parcel (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.returnPerOrder}
                    onChange={(event) => set("returnPerOrder", event.target.value)}
                    hint="What it costs you when a customer refuses delivery."
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Order rules" />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Minimum order value (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.minimumOrderValue}
                    onChange={(event) => set("minimumOrderValue", event.target.value)}
                    hint="0 for no minimum."
                  />
                  <Input
                    label="Max quantity per item"
                    type="number"
                    min={1}
                    step={1}
                    value={form.maxQuantityPerItem}
                    onChange={(event) => set("maxQuantityPerItem", event.target.value)}
                    hint="A low cap limits fake bulk orders."
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Store details"
                  hint="Shown on invoices and in the storefront footer."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Store name"
                    value={form.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Phone"
                      value={form.phone}
                      inputMode="tel"
                      onChange={(event) => set("phone", event.target.value)}
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={(event) => set("email", event.target.value)}
                    />
                  </div>
                  <Textarea
                    label="Address"
                    value={form.address}
                    rows={2}
                    onChange={(event) => set("address", event.target.value)}
                  />
                  <Textarea
                    label="Invoice footer"
                    value={form.invoiceFooter}
                    rows={2}
                    onChange={(event) => set("invoiceFooter", event.target.value)}
                    placeholder="Thank you for shopping with gng."
                  />
                </div>
              </Card>

              <Button
                variant="primary"
                size="lg"
                loading={saving}
                onClick={() => void save()}
                className="self-start 2xl:col-span-2 2xl:justify-self-start"
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}
