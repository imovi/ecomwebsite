"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_PLACEHOLDERS,
  render,
  type TemplateKey,
} from "@/lib/admin/whatsapp-templates";
import { AsyncState, Card, CardHeader, ErrorBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ApiStoreSettings } from "@/lib/api/types";

/**
 * The words the shop sends its customers, in the shop's own hands.
 *
 * These were Bangla strings compiled into the bundle. Changing a greeting,
 * adding a sign-off, or rewording a line after a courier complaint all meant a
 * code change and a deploy — for text that belongs to whoever is talking to the
 * customer, not to whoever wrote the software.
 *
 * EVERY BOX HAS A PREVIEW, AND THAT IS NOT DECORATION
 * A template is a sentence with holes in it. Nobody can tell whether
 * `{{total}}` will read "৳1,070" or "1070" or nothing at all by looking at the
 * template, and a shop that finds out from a customer has already sent it. The
 * preview renders the same function the real message uses, against a made-up
 * order, so what is on screen is what the customer gets.
 *
 * BLANK MEANS "USE YOURS", NOT "SEND NOTHING"
 * Clearing a box restores the built-in wording rather than sending an empty
 * chat. That rule lives in `whatsapp-templates.ts` and the server drops blank
 * entries rather than storing them, so the two halves cannot disagree.
 */

interface Group {
  title: string;
  hint: string;
  keys: { key: TemplateKey; label: string }[];
}

const GROUPS: Group[] = [
  {
    title: "Order updates",
    hint: "The master message template with greeting, items, total, address, and tracking link.",
    keys: [{ key: "order", label: "Main order message format" }],
  },
  {
    title: "What each stage says",
    hint: "The status sentence placed into {{status}} in the main message above. (No need to repeat items, address or total).",
    keys: [
      { key: "status.pending", label: "Order received, not confirmed yet" },
      { key: "status.confirmed", label: "Confirmed on the phone" },
      { key: "status.processing", label: "Being prepared" },
      { key: "status.packed", label: "Packed" },
      { key: "status.shipped", label: "Handed to the courier" },
      { key: "status.delivered", label: "Delivered" },
      { key: "status.cancelled", label: "Cancelled" },
      { key: "status.returned", label: "Came back" },
    ],
  },
  {
    title: "Unfinished checkouts",
    hint: "Sent from Abandoned — someone who left a full basket.",
    keys: [
      { key: "recovery", label: "Can we help?" },
      { key: "couponOffer", label: "Here is free delivery" },
    ],
  },
];

/**
 * A made-up order and a made-up lead, for the previews.
 *
 * Deliberately concrete rather than "Customer name" / "Product name": a shop
 * reading "৳1,070" understands what `{{total}}` does in a way it never would
 * from the word "total".
 */
const SAMPLE: Record<string, string> = {
  store: copy.brand.name,
  orderNumber: "HINAR-10042",
  name: "রহিম উদ্দিন",
  status: "আপনার অর্ডারটি কনফার্ম হয়েছে। আমরা প্যাক করা শুরু করছি।",
  items: "• LED Magnetic Desk Lamp × 1",
  total: "৳1,070",
  address: "House 12, Road 3, Mirpur, Dhaka",
  phone: "01712345678",
  track: "নিজে দেখতে: https://hinarbd.com/track (Order ID HINAR-10042, ফোন 01712345678)",
  code: "HN7K2P",
  expiry: "31 Aug, 3:30 pm",
  link: "https://hinarbd.com/checkout/resume/…",
};

export function WhatsAppTemplates() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ settings: ApiStoreSettings }>("admin/settings");
      setTemplates(data.settings.whatsappTemplates ?? {});
      setDirty(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.patch("admin/settings", { whatsappTemplates: templates });
      toast("Messages saved");
      await load();
    } catch (caught) {
      setSaveError(caught instanceof AdminApiError ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: TemplateKey, value: string) => {
    setTemplates((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const reset = (key: TemplateKey) => {
    setTemplates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setDirty(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={saveError} />

      <AsyncState loading={loading} error={error} onRetry={() => void load()}>
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} hint={group.hint} />
            <div className="flex flex-col gap-5 p-4 pt-0">
              {group.keys.map(({ key, label }) => (
                <Field
                  key={key}
                  label={label}
                  templateKey={key}
                  value={templates[key] ?? ""}
                  onChange={(value) => set(key, value)}
                  onReset={() => reset(key)}
                />
              ))}
            </div>
          </Card>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save messages
          </Button>
          {dirty && <span className="text-caption text-warn">Not saved yet.</span>}
        </div>
      </AsyncState>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  templateKey,
  value,
  onChange,
  onReset,
}: {
  label: string;
  templateKey: TemplateKey;
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const written = value.trim() !== "";
  const effective = written ? value : DEFAULT_TEMPLATES[templateKey];
  const preview = render(effective, SAMPLE);

  /* A hole the renderer will not fill. Left standing in the message rather than
     blanked, so it has to be pointed out here or the shop finds out from a
     customer. */
  const unknown = [...effective.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)]
    .map((match) => match[1]!)
    .filter((name) => !(name in SAMPLE));

  const rows = Math.min(Math.max(effective.split("\n").length + 1, 3), 16);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-caption font-medium text-ink">{label}</span>
        {written ? (
          <button
            type="button"
            onClick={onReset}
            className="text-micro text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Use the standard wording
          </button>
        ) : (
          <span className="text-micro text-muted">Standard wording</span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <textarea
            value={effective}
            rows={rows}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            className="w-full resize-y rounded-sm border border-line bg-white px-3 py-2 text-caption leading-relaxed text-ink focus:border-ink focus:outline-none"
          />

          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_PLACEHOLDERS[templateKey].map((name) => (
              <button
                key={name}
                type="button"
                /* Tapping inserts it, because the useful thing about a list of
                   placeholders is not reading it. */
                onClick={() => onChange(`${effective}{{${name}}}`)}
                className="tnum rounded-xs bg-surface px-1.5 py-0.5 text-micro text-ink-soft hover:bg-line"
              >
                {`{{${name}}}`}
              </button>
            ))}
          </div>
        </div>

        {/* What the customer actually receives. Same renderer as the real
            message, so this cannot drift from what gets sent. */}
        <div className="flex flex-col gap-1">
          <span className="text-micro uppercase tracking-wide text-muted">
            What the customer sees
          </span>
          <pre className="min-h-[7rem] whitespace-pre-wrap break-words rounded-sm bg-positive-soft px-3 py-2 text-caption leading-relaxed text-ink">
            {preview}
          </pre>

          {unknown.length > 0 && (
            <p className={cn("flex items-start gap-1.5 text-micro text-warn")}>
              <Icon name="alert" size={13} />
              <span>
                {unknown.map((name) => `{{${name}}}`).join(", ")} is not a name this message
                knows, so it will be sent to the customer exactly as written.
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
