"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { revalidateStorefront } from "@/lib/admin/revalidate";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { MarketingTabs } from "./MarketingTabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

const PRESETS = [
  {
    label: "Default COD",
    text: "Cash on delivery all over Bangladesh",
    link: "",
  },
  {
    label: "Coupon Code Offer",
    text: "Special Discount! Use code FCC for ?800 OFF",
    link: "/checkout",
  },
  {
    label: "Free Delivery Offer",
    text: "Free delivery on all orders over ?1,500!",
    link: "/",
  },
  {
    label: "Flash Sale Alert",
    text: "Flash Sale is Live! Grab your favorite gadgets today",
    link: "/",
  },
];

export function AnnouncementForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setEnabled(data.announcement?.enabled ?? true);
    setText(data.announcement?.text ?? "Cash on delivery all over Bangladesh");
    setLink(data.announcement?.link ?? "");
  };

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ settings: ApiStoreSettings }>("admin/settings");
      hydrate(data.settings);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Could not load announcement settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        announcement: {
          enabled,
          text: text.trim(),
          link: link.trim(),
        },
      });

      hydrate(data.settings);
      await revalidateStorefront("settings").catch(() => {});

      setSuccessMessage("Announcement bar updated successfully!");
      toast("Announcement bar updated");
    } catch (caught) {
      setSaveError(
        caught instanceof AdminApiError
          ? caught.message
          : "Could not save announcement settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Marketing">
      <PageBody>
        <div className="2xl:col-span-2">
          <MarketingTabs />
        </div>

        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          {settings && (
            <>
              <div className="2xl:col-span-2 space-y-4">
                <ErrorBanner message={saveError} />
                <SuccessBanner message={successMessage} />
              </div>

              {/* --- Live Storefront Preview --- */}
              <div className="2xl:col-span-2">
                <Card>
                  <CardHeader
                    title="Live Header Preview"
                    hint="This is exactly how the announcement strip appears at the very top of your storefront."
                  />
                  <div className="p-4 flex flex-col gap-3">
                    <div className="rounded-lg border border-line overflow-hidden shadow-sm">
                      {enabled ? (
                        <div className="bg-ink text-white px-4 py-2 flex items-center justify-center gap-1.5 text-xs font-medium tracking-wide transition-colors">
                          <Icon name="cash" size={14} />
                          {link ? (
                            <span className="underline cursor-pointer">
                              {text || "Cash on delivery all over Bangladesh"}
                            </span>
                          ) : (
                            <span>{text || "Cash on delivery all over Bangladesh"}</span>
                          )}
                        </div>
                      ) : (
                        <div className="bg-surface text-muted px-4 py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium italic border-b border-line">
                          <Icon name="alert" size={14} />
                          Announcement bar is currently disabled (hidden on storefront)
                        </div>
                      )}

                      {/* Mock header row below the announcement strip */}
                      <div className="bg-white px-4 py-2.5 flex items-center justify-between border-t border-line/40 text-xs text-muted">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-4 bg-muted/20 rounded" />
                        </div>
                        <span className="font-bold tracking-wider text-ink text-sm">
                          {settings.store.name || "HINAR"}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 bg-muted/20 rounded-full" />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* --- Settings Form --- */}
              <div className="2xl:col-span-2">
                <form onSubmit={handleSave}>
                  <Card>
                    <CardHeader
                      title="Announcement Configuration"
                      hint="Turn on/off, customize the text, or add a link for your promotion/coupon."
                    />

                    <div className="p-5 flex flex-col gap-6">
                      {/* Active Toggle */}
                      <div className="flex items-center justify-between p-3 rounded-lg bg-surface/60 border border-line">
                        <div>
                          <div className="font-semibold text-sm text-ink">
                            Announcement Bar Status
                          </div>
                          <div className="text-xs text-muted">
                            {enabled
                              ? "The announcement bar is active and visible to all visitors."
                              : "The announcement bar is hidden on the storefront."}
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-line peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                      </div>

                      {/* Quick Presets */}
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          Quick Presets / Suggestions
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => {
                                setText(preset.text);
                                setLink(preset.link);
                              }}
                              className="px-3 py-1.5 text-xs rounded-full border border-line bg-white hover:bg-surface text-ink transition-colors"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Announcement Text */}
                      <div className="flex flex-col gap-1.5">
                        <Input
                          label="Announcement Text"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder="Cash on delivery all over Bangladesh"
                          maxLength={200}
                          required
                          hint="The text shown at the top of every storefront page. Can be a promotional coupon, notice, or shipping promise."
                        />
                        <div className="text-right text-xs text-muted">
                          {text.length} / 200 characters
                        </div>
                      </div>

                      {/* Announcement Link (Optional) */}
                      <Input
                        label="Destination Link (Optional)"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder="e.g. /checkout or /category/all"
                        hint="Leave blank if you don't want the announcement to be clickable. Enter a relative path (e.g. /checkout) or URL."
                      />

                      {/* Save Button */}
                      <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
                        <Button
                          type="submit"
                          variant="primary"
                          loading={saving}
                          disabled={saving}
                        >
                          Save Announcement
                        </Button>
                      </div>
                    </div>
                  </Card>
                </form>
              </div>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}
