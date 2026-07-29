import { clsx, type ClassValue } from "clsx";

/**
 * Class name joiner.
 *
 * Note we deliberately do NOT use tailwind-merge. Variant maps in this codebase
 * are written so they never emit conflicting utilities for the same property,
 * which keeps ~6KB of merge logic out of every page's bundle.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** The one place currency formatting is defined. */
export function formatTaka(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * Discount is always derived, never stored — a stored percentage silently
 * drifts out of sync the first time someone edits a price in the admin.
 */
export function discountPercent(price: number, oldPrice?: number): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return Math.round(((oldPrice - price) / oldPrice) * 100);
}

export function savings(price: number, oldPrice?: number): number {
  if (!oldPrice || oldPrice <= price) return 0;
  return oldPrice - price;
}

/** Bangladeshi mobile numbers: 11 digits, 013–019 prefixes. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("880")) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
}

export function isValidPhone(input: string): boolean {
  return /^01[3-9]\d{8}$/.test(normalizePhone(input));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
