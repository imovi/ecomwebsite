"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { revalidateStorefront } from "@/lib/admin/revalidate";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { CustomizationTabs } from "./CustomizationTabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

const DEFAULT_ANNOUNCEMENT = {
  text: "Cash on delivery all over Bangladesh",
  link: "",
  enabled: true,
};

const PRESETS = [
  {
    id: "default",
    label: "Default (Cash on Delivery)",
    tag: "Permanent Default",
    text: "Cash on delivery all over Bangladesh",
    link: "",
    desc: "Original default announcement. Restores the standard nationwide cash-on-delivery message.",
  },
  {
    id: "coupon",
    label: "Promotional Coupon Offer",
    tag: "Promotion",
    text: "Special Discount! Use code FCC for ৳800 OFF",
    link: "/checkout",
    desc: "Highlights an active promotional coupon code to drive checkout conversion.",
  },
  {
    id: "free_delivery",
    label: "Free Delivery Offer",
    tag: "Shipping Offer",
    text: "Free delivery on all orders over ৳1,500!",
    link: "/",
    desc: "Promotes free delivery threshold on qualifying basket sizes.",
  },
  {
    id: "sale",
    label: "Flash Sale Alert",
    tag: "Campaign",
    text: "Flash Sale is Live! Grab your favorite gadgets today",
    link: "/",
    desc: "Announces limited-time promotions, holiday campaigns, or clearance discounts.",
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
    setText(data.announcement?.text || DEFAULT_ANNOUNCEMENT.text);
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

  const applyDefault = () => {
    setText(DEFAULT_ANNOUNCEMENT.text);
    setLink(DEFAULT_ANNOUNCEMENT.link);
    setEnabled(true);
    toast("Default format loaded. Click Save to apply.");
  };

  const isDefaultActive =
    text.trim() === DEFAULT_ANNOUNCEMENT.text &&
    link.trim() === DEFAULT_ANNOUNCEMENT.link &&
    enabled === true;

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        announcement: {
          enabled,
          text: text.trim() || DEFAULT_ANNOUNCEMENT.text,
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
    <AdminShell title="Customization">
      <PageBody>
        <div className="2xl:col-span-2">
          <CustomizationTabs />
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

              {/* --- Permanent Default Format Banner --- */}
              <div className="2xl:col-span-2">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5 sm:mt-0">
                      <Icon name="cash" size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink">
                          Permanent Default Format
                        </span>
                        {isDefaultActive ? (
                          <span className="px-2 py-0.5 rounded-full text-micro font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            Currently Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-micro font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                            Custom in Use
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        <span className="font-mono text-ink font-medium">
                          &quot;Cash on delivery all over Bangladesh&quot;
                        </span>{" "}
                        — Even after running temporary promotional campaigns, you can switch back to this default format at any time.
                      </p>
                    </div>
                  </div>

                  {!isDefaultActive && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={applyDefault}
                      className="shrink-0 self-start sm:self-center bg-white hover:bg-surface border-line"
                    >
                      <Icon name="refresh" size={14} className="mr-1" />
                      Restore Default
                    </Button>
                  )}
                </div>
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
                              {text || DEFAULT_ANNOUNCEMENT.text}
                            </span>
                          ) : (
                            <span>{text || DEFAULT_ANNOUNCEMENT.text}</span>
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

              {/* --- Saved Formats & Presets --- */}
              <div className="2xl:col-span-2">
                <Card>
                  <CardHeader
                    title="Saved Formats & Presets"
                    hint="Click any preset below to load it into the editor, customize if needed, and save."
                  />
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {PRESETS.map((preset) => {
                      const isSelected = text.trim() === preset.text.trim();
                      return (
                        <div
                          key={preset.id}
                          onClick={() => {
                            setText(preset.text);
                            setLink(preset.link);
                            setEnabled(true);
                          }}
                          className={cn(
                            "cursor-pointer rounded-lg border p-3.5 transition-all flex flex-col justify-between gap-2",
                            isSelected
                              ? "border-primary bg-primary/[0.03] shadow-sm ring-1 ring-primary/30"
                              : "border-line bg-white hover:bg-surface/50 hover:border-line-dark"
                          )}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-semibold text-xs text-ink">
                                {preset.label}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-muted border border-line">
                                {preset.tag}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-ink bg-surface/70 px-2 py-1 rounded border border-line/60">
                              {preset.text}
                            </div>
                            <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                              {preset.desc}
                            </p>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-line/40 text-[11px]">
                            <span className="text-muted">
                              {preset.link ? `Link: ${preset.link}` : "No link"}
                            </span>
                            <span className={cn("font-medium", isSelected ? "text-primary font-bold" : "text-muted")}>
                              {isSelected ? "Selected ✓" : "Click to use →"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* --- Settings Form --- */}
              <div className="2xl:col-span-2">
                <form onSubmit={handleSave}>
                  <Card>
                    <CardHeader
                      title="Announcement Configuration"
                      hint="Turn on or off, customize wording, or add a link for your promotion/coupon."
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
                        <div className="flex justify-between items-center text-xs text-muted">
                          <button
                            type="button"
                            onClick={applyDefault}
                            className="text-primary hover:underline font-medium"
                          >
                            Reset to &quot;Cash on delivery all over Bangladesh&quot;
                          </button>
                          <span>{text.length} / 200 characters</span>
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

                      {/* Save & Reset Buttons */}
                      <div className="flex items-center justify-between gap-3 pt-4 border-t border-line">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={applyDefault}
                          disabled={saving || isDefaultActive}
                        >
                          <Icon name="refresh" size={14} className="mr-1" />
                          Reset to Default
                        </Button>

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
