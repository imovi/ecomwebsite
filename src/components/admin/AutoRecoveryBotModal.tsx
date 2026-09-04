"use client";

import { useState, useMemo } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import type { Lead } from "./LeadCard";
import {
  recoveryMessage,
  couponOfferMessage,
  whatsappHref,
  whatsappNumber,
} from "@/lib/admin/whatsapp";

interface AutoRecoveryBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  templates: Record<string, string>;
  onLeadsUpdated: () => void;
}

export function AutoRecoveryBotModal({
  isOpen,
  onClose,
  leads,
  templates,
  onLeadsUpdated,
}: AutoRecoveryBotModalProps) {
  const [delayMinutes, setDelayMinutes] = useState<number>(15);
  const [mode, setMode] = useState<"help" | "coupon">("help");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  // Filter leads ready for auto-recovery:
  // 1. Not recovered
  // 2. Not dismissed
  // 3. Has valid BD phone
  // 4. Abandoned more than `delayMinutes` ago
  // 5. If help mode: helpMessageSentAt is null. If coupon mode: couponOfferSentAt is null
  const queue = useMemo(() => {
    const cutoff = Date.now() - delayMinutes * 60 * 1000;

    return leads.filter((lead) => {
      if (lead.recovered || lead.status === "dismissed") return false;
      if (!whatsappNumber(lead.phone)) return false;

      const lastSeen = new Date(lead.lastSeenAt).getTime();
      if (lastSeen > cutoff) return false;

      if (mode === "help" && lead.helpMessageSentAt) return false;
      if (mode === "coupon" && lead.couponOfferSentAt) return false;

      return true;
    });
  }, [leads, delayMinutes, mode]);

  const currentLead = queue[currentIndex] ?? null;

  // Build current message preview
  const messagePreview = useMemo(() => {
    if (!currentLead) return "";
    if (mode === "coupon" && currentLead.coupon) {
      return couponOfferMessage(currentLead, currentLead.coupon, {
        storeName: "Hinar BD",
        templates,
      });
    }
    return recoveryMessage(currentLead, {
      storeName: "Hinar BD",
      templates,
    });
  }, [currentLead, mode, templates]);

  if (!isOpen) return null;

  async function handleSendAndNext() {
    if (!currentLead) return;
    setBusy(true);

    try {
      let coupon = currentLead.coupon;

      // In coupon mode, ensure coupon is generated first
      if (mode === "coupon" && !coupon) {
        const res = await adminApi.post<{ coupon: any }>(
          `admin/abandoned/${currentLead.id}/coupon`,
          {},
        );
        coupon = res.coupon;
      }

      // Build text to send
      const text =
        mode === "coupon" && coupon
          ? couponOfferMessage(currentLead, coupon, { storeName: "Hinar BD", templates })
          : recoveryMessage(currentLead, { storeName: "Hinar BD", templates });

      const url = whatsappHref(currentLead.phone, text);

      // Open WhatsApp chat in new tab
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }

      // Mark as sent in database
      await adminApi.post(`admin/abandoned/${currentLead.id}/sent`, {
        kind: mode === "coupon" ? "coupon_offer" : "help",
      });

      setSentCount((c) => c + 1);
      toast(`Recovery message sent to ${currentLead.customerName || currentLead.phone}!`, {
        tone: "positive",
      });

      onLeadsUpdated();

      // Advance to next
      if (currentIndex < queue.length - 1) {
        setCurrentIndex((i) => i + 1);
      }
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Failed to record message", {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      toast("Reached end of queue", { tone: "default" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl rounded-2xl border border-line bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4 bg-surface/50">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-white">
              <svg className="size-5 fill-current" viewBox="0 0 24 24">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
              </svg>
            </span>
            <div>
              <h2 className="text-title font-semibold text-ink">Auto WhatsApp Recovery Bot</h2>
              <p className="text-caption text-muted">Rapid 1-Click abandoned cart recovery runner</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Controls & Timing Rules */}
        <div className="border-b border-line px-6 py-3.5 bg-surface/30 flex flex-wrap items-center justify-between gap-3 text-caption">
          <div className="flex items-center gap-3">
            <span className="font-medium text-ink">Delay trigger:</span>
            <select
              value={delayMinutes}
              onChange={(e) => {
                setDelayMinutes(Number(e.target.value));
                setCurrentIndex(0);
              }}
              className="h-8 rounded-sm border border-line bg-white px-2 text-caption text-ink"
            >
              <option value={10}>10 minutes ago</option>
              <option value={15}>15 minutes ago (Recommended)</option>
              <option value={30}>30 minutes ago</option>
              <option value={60}>1 hour ago</option>
              <option value={120}>2 hours ago</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("help");
                setCurrentIndex(0);
              }}
              className={`px-3 py-1 rounded-sm font-medium transition-colors ${
                mode === "help"
                  ? "bg-ink text-white"
                  : "bg-white border border-line text-ink-soft hover:bg-surface"
              }`}
            >
              Help / Follow-up
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("coupon");
                setCurrentIndex(0);
              }}
              className={`px-3 py-1 rounded-sm font-medium transition-colors ${
                mode === "coupon"
                  ? "bg-ink text-white"
                  : "bg-white border border-line text-ink-soft hover:bg-surface"
              }`}
            >
              Special Offer Coupon
            </button>
          </div>
        </div>

        {/* Queue Status Bar */}
        <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200/60 flex items-center justify-between text-caption text-amber-900">
          <span>
            Queue: <strong>{queue.length}</strong> eligible abandoned carts ready for recovery
          </span>
          <span>
            Sent this session: <strong>{sentCount}</strong>
          </span>
        </div>

        {/* Body / Current Lead Card */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="size-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                <svg className="size-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-body font-semibold text-ink">All caught up!</h3>
              <p className="mt-1 max-w-sm text-caption text-muted">
                There are no pending uncontacted checkouts matching the current {delayMinutes}-minute delay.
              </p>
            </div>
          ) : currentLead ? (
            <div className="space-y-4">
              {/* Progress counter */}
              <div className="flex items-center justify-between text-micro text-muted">
                <span>
                  Customer {currentIndex + 1} of {queue.length}
                </span>
                <span>
                  Cart Value: <strong>Tk {currentLead.estimatedValue}</strong> ({currentLead.itemCount} items)
                </span>
              </div>

              {/* Customer Box */}
              <div className="rounded-xl border border-line p-4 bg-surface/40">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-body font-semibold text-ink">
                      {currentLead.customerName || "Customer (No name)"}
                    </h4>
                    <p className="text-caption font-medium text-emerald-700">{currentLead.phone}</p>
                    {currentLead.address && (
                      <p className="text-micro text-muted mt-1">
                        {currentLead.address}, {currentLead.areaText}
                      </p>
                    )}
                  </div>
                  <span className="text-micro bg-line/80 px-2 py-0.5 rounded-sm text-ink-soft">
                    {currentLead.stage}
                  </span>
                </div>

                <div className="mt-3 border-t border-line/60 pt-2 text-micro text-ink-soft">
                  Cart items: {currentLead.contents?.map((c) => `${c.name} × ${c.quantity}`).join(", ") || "No items recorded"}
                </div>
              </div>

              {/* Message Preview Box */}
              <div>
                <label className="block text-micro uppercase tracking-wider font-semibold text-muted mb-1.5">
                  Personalized WhatsApp Message (Contains deep resume cart link):
                </label>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 font-mono text-caption text-ink whitespace-pre-wrap leading-relaxed">
                  {messagePreview}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        {queue.length > 0 && currentLead && (
          <div className="border-t border-line px-6 py-4 bg-surface/60 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSkip}
              disabled={busy || currentIndex >= queue.length - 1}
              className="px-4 py-2 rounded-md border border-line text-caption font-medium text-ink hover:bg-surface disabled:opacity-40"
            >
              Skip →
            </button>

            <button
              type="button"
              onClick={handleSendAndNext}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-2.5 text-body font-semibold text-white hover:bg-emerald-700 active:scale-98 transition-all shadow-md disabled:opacity-60"
            >
              <svg className="size-5 fill-current" viewBox="0 0 24 24">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
              </svg>
              <span>{busy ? "Processing..." : "Launch WhatsApp & Next →"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
