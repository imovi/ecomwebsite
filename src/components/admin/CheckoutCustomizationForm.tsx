"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { revalidateStorefront } from "@/lib/admin/revalidate";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import type { CheckoutFormConfig } from "@/types";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { CustomizationTabs } from "./CustomizationTabs";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

export const DEFAULT_CHECKOUT_CONFIG: Required<CheckoutFormConfig> = {
  areaEnabled: true,
  couponEnabled: true,
  notesEnabled: false,

  contactHeading: "Delivery details",
  zoneHeading: "Delivery area",
  paymentHeading: "Payment",
  summaryHeading: "Order summary",

  nameLabel: "Full name",
  namePlaceholder: "e.g. Rahim Uddin",
  phoneLabel: "Phone number",
  phonePlaceholder: "01XXXXXXXXX",
  phoneHint: "We'll call this number to confirm your order",
  addressLabel: "Full address",
  addressPlaceholder: "House / road / block, landmark",
  areaLabel: "Area / Thana / District",
  areaPlaceholder: "e.g. Dhanmondi, Dhaka",

  zoneInsideLabel: "Inside Dhaka",
  zoneOutsideLabel: "Outside Dhaka",

  codTitle: "Cash on Delivery",
  codSubtitle: "Pay the courier when your order arrives",
  submitButtonText: "Place Order",
  submittingButtonText: "Placing order…",

  couponPrompt: "Have a coupon code?",
  couponPlaceholder: "Coupon code",
  couponApplyButton: "Apply",

  notesLabel: "Order notes (optional)",
  notesPlaceholder: "Special delivery instructions (e.g. call before arriving)",
};

export const BANGLA_CHECKOUT_CONFIG: Required<CheckoutFormConfig> = {
  areaEnabled: true,
  couponEnabled: true,
  notesEnabled: false,

  contactHeading: "অর্ডারের জন্য ডেলিভারি তথ্য দিন",
  zoneHeading: "ডেলিভারি এলাকা নির্বাচন করুন",
  paymentHeading: "পেমেন্ট পদ্ধতি",
  summaryHeading: "অর্ডার সামারি",

  nameLabel: "আপনার সম্পূর্ণ নাম",
  namePlaceholder: "যেমন: মোঃ রহিম উদ্দিন",
  phoneLabel: "মোবাইল নাম্বার",
  phonePlaceholder: "০১XXXXXXXXX",
  phoneHint: "অর্ডার কনফার্ম করার জন্য এই নম্বরে কল করা হবে",
  addressLabel: "সম্পূর্ণ ঠিকানা",
  addressPlaceholder: "বাসা নং, রোড নং, এলাকা ও ল্যান্ডমার্ক",
  areaLabel: "থানা / জেলা",
  areaPlaceholder: "যেমন: ধানমন্ডি, ঢাকা",

  zoneInsideLabel: "ঢাকার ভিতরে",
  zoneOutsideLabel: "ঢাকার বাইরে",

  codTitle: "ক্যাশ অন ডেলিভারি",
  codSubtitle: "পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন",
  submitButtonText: "অর্ডার কনফার্ম করুন",
  submittingButtonText: "অর্ডার প্রসেস হচ্ছে…",

  couponPrompt: "ডিসকাউন্ট কুপন কোড আছে?",
  couponPlaceholder: "কুপন কোড লিখুন",
  couponApplyButton: "প্রয়োগ করুন",

  notesLabel: "বিশেষ নির্দেশনা (ঐচ্ছিক)",
  notesPlaceholder: "ডেলিভারির জন্য কোনো বিশেষ নোট থাকলে লিখুন",
};

export function CheckoutCustomizationForm() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"fields" | "headings" | "toggles">("fields");

  const [form, setForm] = useState<Required<CheckoutFormConfig>>(DEFAULT_CHECKOUT_CONFIG);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ settings: ApiStoreSettings }>("admin/settings");
      const saved = (data.settings.checkoutFormConfig ?? {}) as Partial<CheckoutFormConfig>;
      setForm({
        ...DEFAULT_CHECKOUT_CONFIG,
        ...saved,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const updateField = <K extends keyof CheckoutFormConfig>(key: K, value: CheckoutFormConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccessMessage(null);
    setSaveError(null);
  };

  const applyPreset = (preset: "english" | "bangla") => {
    if (preset === "english") {
      setForm((prev) => ({
        ...DEFAULT_CHECKOUT_CONFIG,
        areaEnabled: prev.areaEnabled,
        couponEnabled: prev.couponEnabled,
        notesEnabled: prev.notesEnabled,
      }));
      toast("Applied English preset");
    } else {
      setForm((prev) => ({
        ...BANGLA_CHECKOUT_CONFIG,
        areaEnabled: prev.areaEnabled,
        couponEnabled: prev.couponEnabled,
        notesEnabled: prev.notesEnabled,
      }));
      toast("Applied Bangla (বাংলা) preset");
    }
    setSuccessMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      await adminApi.patch("admin/settings", {
        checkoutFormConfig: form,
      });

      // Clear storefront cache so checkout page updates immediately
      await revalidateStorefront("settings");

      setSuccessMessage("Checkout customization successfully saved & storefront updated!");
      toast("Checkout settings saved");
    } catch (caught) {
      setSaveError(caught instanceof AdminApiError ? caught.message : "Could not save checkout settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="Customization">
      <PageBody columns={false}>
        <CustomizationTabs />

        <AsyncState loading={loading} error={error} onRetry={() => void load()}>
          <div className="space-y-6">
            <ErrorBanner message={saveError} />
            <SuccessBanner message={successMessage} />

            {/* Top preset bar */}
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-base text-ink">Checkout Form Language & Layout</h3>
                <p className="text-caption text-muted mt-0.5">
                  Customize the labels, button texts, language, or toggle fields on the customer checkout page.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => applyPreset("english")}
                >
                  🇬🇧 English Preset
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => applyPreset("bangla")}
                >
                  🇧🇩 বাংলা Preset
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={saving}
                  onClick={() => void save()}
                >
                  Save Changes
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Form settings column */}
              <div className="lg:col-span-7 space-y-6">
                {/* Secondary navigation for settings */}
                <div className="flex border-b border-line gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("fields")}
                    className={cn(
                      "px-3 py-2 text-caption font-medium border-b-2 transition-colors -mb-px",
                      activeTab === "fields"
                        ? "border-primary text-primary font-semibold"
                        : "border-transparent text-muted hover:text-ink"
                    )}
                  >
                    Field Labels & Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("headings")}
                    className={cn(
                      "px-3 py-2 text-caption font-medium border-b-2 transition-colors -mb-px",
                      activeTab === "headings"
                        ? "border-primary text-primary font-semibold"
                        : "border-transparent text-muted hover:text-ink"
                    )}
                  >
                    Headings & Buttons
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("toggles")}
                    className={cn(
                      "px-3 py-2 text-caption font-medium border-b-2 transition-colors -mb-px",
                      activeTab === "toggles"
                        ? "border-primary text-primary font-semibold"
                        : "border-transparent text-muted hover:text-ink"
                    )}
                  >
                    Field Switches (On/Off)
                  </button>
                </div>

                {activeTab === "fields" && (
                  <div className="space-y-5">
                    <Card>
                      <CardHeader
                        title="Customer Name & Phone"
                        hint="Labels and hints for contact information."
                      />
                      <div className="p-4 pt-0 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Full Name Label"
                          value={form.nameLabel}
                          onChange={(e) => updateField("nameLabel", e.target.value)}
                        />
                        <Input
                          label="Full Name Placeholder"
                          value={form.namePlaceholder}
                          onChange={(e) => updateField("namePlaceholder", e.target.value)}
                        />
                        <Input
                          label="Phone Number Label"
                          value={form.phoneLabel}
                          onChange={(e) => updateField("phoneLabel", e.target.value)}
                        />
                        <Input
                          label="Phone Number Placeholder"
                          value={form.phonePlaceholder}
                          onChange={(e) => updateField("phonePlaceholder", e.target.value)}
                        />
                        <div className="sm:col-span-2">
                          <Input
                            label="Phone Verification Hint"
                            value={form.phoneHint}
                            onChange={(e) => updateField("phoneHint", e.target.value)}
                            hint="Small explanatory text displayed directly beneath phone field."
                          />
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <CardHeader
                        title="Shipping Address"
                        hint="Address and location input settings."
                      />
                      <div className="p-4 pt-0 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Address Field Label"
                          value={form.addressLabel}
                          onChange={(e) => updateField("addressLabel", e.target.value)}
                        />
                        <Input
                          label="Address Placeholder"
                          value={form.addressPlaceholder}
                          onChange={(e) => updateField("addressPlaceholder", e.target.value)}
                        />
                        {form.areaEnabled && (
                          <>
                            <Input
                              label="Area / Thana Label"
                              value={form.areaLabel}
                              onChange={(e) => updateField("areaLabel", e.target.value)}
                            />
                            <Input
                              label="Area / Thana Placeholder"
                              value={form.areaPlaceholder}
                              onChange={(e) => updateField("areaPlaceholder", e.target.value)}
                            />
                          </>
                        )}
                        {form.notesEnabled && (
                          <>
                            <Input
                              label="Order Notes Label"
                              value={form.notesLabel}
                              onChange={(e) => updateField("notesLabel", e.target.value)}
                            />
                            <Input
                              label="Order Notes Placeholder"
                              value={form.notesPlaceholder}
                              onChange={(e) => updateField("notesPlaceholder", e.target.value)}
                            />
                          </>
                        )}
                      </div>
                    </Card>

                    <Card>
                      <CardHeader
                        title="Delivery Zones & Coupon Text"
                        hint="Labels for shipping zones and coupon box."
                      />
                      <div className="p-4 pt-0 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Inside Dhaka Label"
                          value={form.zoneInsideLabel}
                          onChange={(e) => updateField("zoneInsideLabel", e.target.value)}
                        />
                        <Input
                          label="Outside Dhaka Label"
                          value={form.zoneOutsideLabel}
                          onChange={(e) => updateField("zoneOutsideLabel", e.target.value)}
                        />
                        {form.couponEnabled && (
                          <>
                            <Input
                              label="Coupon Trigger Prompt"
                              value={form.couponPrompt}
                              onChange={(e) => updateField("couponPrompt", e.target.value)}
                            />
                            <Input
                              label="Coupon Input Placeholder"
                              value={form.couponPlaceholder}
                              onChange={(e) => updateField("couponPlaceholder", e.target.value)}
                            />
                            <Input
                              label="Coupon Apply Button"
                              value={form.couponApplyButton}
                              onChange={(e) => updateField("couponApplyButton", e.target.value)}
                            />
                          </>
                        )}
                      </div>
                    </Card>
                  </div>
                )}

                {activeTab === "headings" && (
                  <div className="space-y-5">
                    <Card>
                      <CardHeader
                        title="Section Titles & Headings"
                        hint="The section headers dividing each step of the checkout form."
                      />
                      <div className="p-4 pt-0 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Delivery Details Section Title"
                          value={form.contactHeading}
                          onChange={(e) => updateField("contactHeading", e.target.value)}
                        />
                        <Input
                          label="Delivery Area Section Title"
                          value={form.zoneHeading}
                          onChange={(e) => updateField("zoneHeading", e.target.value)}
                        />
                        <Input
                          label="Payment Method Section Title"
                          value={form.paymentHeading}
                          onChange={(e) => updateField("paymentHeading", e.target.value)}
                        />
                        <Input
                          label="Order Summary Section Title"
                          value={form.summaryHeading}
                          onChange={(e) => updateField("summaryHeading", e.target.value)}
                        />
                      </div>
                    </Card>

                    <Card>
                      <CardHeader
                        title="Action Buttons & Payment Method"
                        hint="Place Order button text and cash on delivery descriptions."
                      />
                      <div className="p-4 pt-0 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Place Order Button Text"
                          value={form.submitButtonText}
                          onChange={(e) => updateField("submitButtonText", e.target.value)}
                          hint="e.g. Place Order or অর্ডার নিশ্চিত করুন"
                        />
                        <Input
                          label="Button Loading State Text"
                          value={form.submittingButtonText}
                          onChange={(e) => updateField("submittingButtonText", e.target.value)}
                        />
                        <Input
                          label="Cash on Delivery Title"
                          value={form.codTitle}
                          onChange={(e) => updateField("codTitle", e.target.value)}
                        />
                        <Input
                          label="Cash on Delivery Subtitle"
                          value={form.codSubtitle}
                          onChange={(e) => updateField("codSubtitle", e.target.value)}
                        />
                      </div>
                    </Card>
                  </div>
                )}

                {activeTab === "toggles" && (
                  <div className="space-y-5">
                    <Card>
                      <CardHeader
                        title="Optional Form Fields"
                        hint="Choose which optional sections are visible to your buyers."
                      />
                      <div className="p-4 pt-0 divide-y divide-line">
                        {/* Coupon Toggle */}
                        <div className="py-4 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-body font-medium text-ink">Coupon Code Section</p>
                            <p className="text-caption text-muted">
                              Display the "Have a coupon code?" accordion on the checkout form. Turn off if you aren't running coupon promotions.
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={form.couponEnabled}
                              onChange={(e) => updateField("couponEnabled", e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                          </label>
                        </div>

                        {/* Area / Thana Toggle */}
                        <div className="py-4 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-body font-medium text-ink">Area / Thana / District Field</p>
                            <p className="text-caption text-muted">
                              Shows the dedicated area/thana selector for automated courier city matching.
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={form.areaEnabled}
                              onChange={(e) => updateField("areaEnabled", e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                          </label>
                        </div>

                        {/* Order Notes Toggle */}
                        <div className="py-4 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-body font-medium text-ink">Order Notes (Customer Instructions)</p>
                            <p className="text-caption text-muted">
                              Allows customers to leave special instructions for delivery riders.
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={form.notesEnabled}
                              onChange={(e) => updateField("notesEnabled", e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                          </label>
                        </div>
                      </div>
                    </Card>

                    <div className="rounded-xl border border-line/60 bg-amber-50/50 p-4 flex gap-3 text-caption text-amber-900">
                      <Icon name="alert" size={18} className="text-amber-700 shrink-0 mt-0.5" />
                      <p>
                        <strong>Note on Courier Compatibility:</strong> Customer Full Name, Mobile Number, and Full Address are mandatory for automated shipping creation with Steadfast & Pathao. You can customize their labels into Bangla or English, but they remain permanently active.
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    loading={saving}
                    onClick={() => void save()}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>

              {/* Live Preview column */}
              <div className="lg:col-span-5">
                <div className="sticky top-20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-caption font-semibold text-muted flex items-center gap-1.5 uppercase tracking-wide">
                      <Icon name="eye" size={14} />
                      Live Customer Preview
                    </span>
                    <span className="text-micro text-muted">Real-time simulation</span>
                  </div>

                  <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-sm space-y-4 max-h-[80vh] overflow-y-auto">
                    {/* Simulated Delivery Details */}
                    <div className="space-y-3 bg-white p-4 rounded-xl border border-line/70">
                      <h4 className="text-caption font-bold text-ink">
                        {form.contactHeading || "Delivery details"}
                      </h4>

                      <div>
                        <label className="text-micro font-medium text-muted block mb-1">
                          {form.nameLabel || "Full name"} *
                        </label>
                        <div className="border border-line rounded-sm px-3 py-2 text-caption text-slate-400 bg-surface">
                          {form.namePlaceholder || "e.g. Rahim Uddin"}
                        </div>
                      </div>

                      <div>
                        <label className="text-micro font-medium text-muted block mb-1">
                          {form.phoneLabel || "Phone number"} *
                        </label>
                        <div className="border border-line rounded-sm px-3 py-2 text-caption text-slate-400 bg-surface">
                          {form.phonePlaceholder || "01XXXXXXXXX"}
                        </div>
                        {form.phoneHint && (
                          <p className="text-micro text-slate-400 mt-1">{form.phoneHint}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-micro font-medium text-muted block mb-1">
                          {form.addressLabel || "Full address"} *
                        </label>
                        <div className="border border-line rounded-sm px-3 py-2 text-caption text-slate-400 bg-surface h-16">
                          {form.addressPlaceholder || "House / road / block, landmark"}
                        </div>
                      </div>

                      {form.areaEnabled && (
                        <div>
                          <label className="text-micro font-medium text-muted block mb-1">
                            {form.areaLabel || "Area / Thana / District"} *
                          </label>
                          <div className="border border-line rounded-sm px-3 py-2 text-caption text-slate-400 bg-surface">
                            {form.areaPlaceholder || "e.g. Dhanmondi, Dhaka"}
                          </div>
                        </div>
                      )}

                      {form.notesEnabled && (
                        <div>
                          <label className="text-micro font-medium text-muted block mb-1">
                            {form.notesLabel || "Order notes (optional)"}
                          </label>
                          <div className="border border-line rounded-sm px-3 py-2 text-caption text-slate-400 bg-surface h-12">
                            {form.notesPlaceholder || "Special delivery instructions"}
                          </div>
                        </div>
                      )}

                      {/* Delivery Area */}
                      <div className="pt-2">
                        <label className="text-micro font-medium text-muted block mb-1.5">
                          {form.zoneHeading || "Delivery area"} *
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="border-2 border-primary bg-primary/5 rounded-sm p-2 text-center text-caption font-medium text-primary">
                            {form.zoneInsideLabel || "Inside Dhaka"}
                          </div>
                          <div className="border border-line bg-white rounded-sm p-2 text-center text-caption text-muted">
                            {form.zoneOutsideLabel || "Outside Dhaka"}
                          </div>
                        </div>
                      </div>

                      {/* Coupon Accordion */}
                      {form.couponEnabled && (
                        <div className="pt-1">
                          <div className="text-caption text-primary font-medium flex items-center gap-1.5 cursor-pointer">
                            <Icon name="checkCircle" size={14} />
                            <span>{form.couponPrompt || "Have a coupon code?"}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Payment simulation */}
                    <div className="bg-white p-4 rounded-xl border border-line/70 space-y-2">
                      <h4 className="text-caption font-bold text-ink">
                        {form.paymentHeading || "Payment"}
                      </h4>
                      <div className="flex items-center gap-2.5 rounded-sm border border-primary bg-primary/5 p-3">
                        <Icon name="cash" size={18} className="text-primary" />
                        <div className="flex-1">
                          <p className="text-caption font-semibold text-ink">
                            {form.codTitle || "Cash on Delivery"}
                          </p>
                          <p className="text-micro text-muted">
                            {form.codSubtitle || "Pay the courier when your order arrives"}
                          </p>
                        </div>
                        <Icon name="checkCircle" size={16} className="text-primary" />
                      </div>
                    </div>

                    {/* Place Order button simulation */}
                    <div>
                      <div className="w-full bg-primary text-white font-semibold py-3 px-4 rounded-sm text-center text-caption shadow-xs">
                        {form.submitButtonText || "Place Order"} · ৳1,450
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}
