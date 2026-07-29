import { NotFoundError } from "../../core/errors.js";
import { getSettings } from "../settings/settings.service.js";
import { findOrderDetail } from "./order.repository.js";
import { toOrderItemDto, type OrderItemDto } from "./order.types.js";
import type { DeliveryZone, OrderStatus, PaymentMethod } from "../../db/schema/order-enums.js";

/**
 * Invoices.
 *
 * Built from the CURRENT order row every time it is requested. There is no
 * stored invoice document and no snapshot of one — the requirement is that an
 * invoice always reflects the latest edited information, and the only way to
 * guarantee that is to have nothing else to fall out of date.
 *
 * The line prices on it are still the prices captured at order time, because
 * those live on `order_items` (Phase 3 snapshot rule). Editing a product's
 * price today does not change what a past invoice says the customer owes.
 */

export interface InvoiceDto {
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    footer: string;
  };
  invoiceNumber: string;
  issuedAt: string;
  order: {
    orderNumber: string;
    placedAt: string;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    /** Cash on delivery is unpaid until the courier collects. */
    paymentStatus: "unpaid" | "paid";
    amountDue: number;
  };
  customer: {
    name: string;
    phone: string;
    address: string;
    area: string;
    deliveryZone: DeliveryZone;
  };
  items: OrderItemDto[];
  totals: {
    subtotal: number;
    deliveryCharge: number;
    grandTotal: number;
    totalQuantity: number;
  };
}

export async function buildInvoice(orderIdOrNumber: string): Promise<InvoiceDto> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    orderIdOrNumber,
  );

  const [detail, settings] = await Promise.all([
    findOrderDetail(isUuid ? { id: orderIdOrNumber } : { orderNumber: orderIdOrNumber }),
    getSettings(),
  ]);

  if (!detail) throw new NotFoundError("Order not found.");

  const { order, items } = detail;

  return {
    store: {
      name: settings.storeName,
      phone: settings.storePhone,
      email: settings.storeEmail,
      address: settings.storeAddress,
      footer: settings.invoiceFooter,
    },
    /* The order number is the invoice number. A separate sequence would mean
       two identifiers for one transaction and a support call every time they
       are quoted interchangeably. */
    invoiceNumber: order.orderNumber,
    issuedAt: new Date().toISOString(),
    order: {
      orderNumber: order.orderNumber,
      placedAt: order.createdAt.toISOString(),
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.status === "delivered" ? "paid" : "unpaid",
      amountDue: order.status === "delivered" ? 0 : order.grandTotal,
    },
    customer: {
      name: order.customerName,
      phone: order.phone,
      address: order.address,
      area: order.areaText,
      deliveryZone: order.deliveryZone,
    },
    items: items.map(toOrderItemDto),
    totals: {
      subtotal: order.subtotal,
      deliveryCharge: order.deliveryCharge,
      grandTotal: order.grandTotal,
      totalQuantity: order.totalQuantity,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Printable rendering                                                        */
/* -------------------------------------------------------------------------- */

/** Escapes text before interpolation. Customer names and addresses are
 *  attacker-influenced free text and must never be trusted in markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const taka = (amount: number): string => `৳${amount.toLocaleString("en-US")}`;

/**
 * Renders a print-ready invoice.
 *
 * Self-contained HTML with inline CSS and an A5-ish print stylesheet: it has
 * to survive being opened straight from the admin panel and sent to a thermal
 * or A4 printer with no external stylesheet available.
 */
export function renderInvoiceHtml(invoice: InvoiceDto): string {
  const rows = invoice.items
    .map(
      (item, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td>
          <div class="name">${escapeHtml(item.productName)}</div>
          ${item.variantLabel ? `<div class="meta">${escapeHtml(item.variantLabel)}</div>` : ""}
          <div class="meta">SKU: ${escapeHtml(item.sku)}</div>
        </td>
        <td class="num">${item.quantity}</td>
        <td class="num">${taka(item.unitPrice)}</td>
        <td class="num">${taka(item.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  *{ box-sizing: border-box; }
  body{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif;
        color:#111; margin:0; padding:24px; font-size:13px; line-height:1.5; }
  .sheet{ max-width:760px; margin:0 auto; }
  header{ display:flex; justify-content:space-between; gap:24px;
          border-bottom:2px solid #111; padding-bottom:16px; }
  .store-name{ font-size:22px; font-weight:700; letter-spacing:-0.02em; }
  .muted{ color:#666; }
  .doc-title{ font-size:18px; font-weight:600; text-align:right; }
  .grid{ display:flex; gap:32px; margin:20px 0; }
  .grid > div{ flex:1; }
  h2{ font-size:11px; text-transform:uppercase; letter-spacing:0.08em;
      color:#666; margin:0 0 6px; font-weight:600; }
  table{ width:100%; border-collapse:collapse; margin-top:8px; }
  th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
      color:#666; border-bottom:1px solid #ddd; padding:8px 6px; }
  td{ padding:10px 6px; border-bottom:1px solid #eee; vertical-align:top; }
  .num{ text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  th.num{ text-align:right; }
  .name{ font-weight:600; }
  .meta{ color:#666; font-size:11px; }
  .totals{ margin-left:auto; width:280px; margin-top:12px; }
  .totals div{ display:flex; justify-content:space-between; padding:5px 0; }
  .totals .grand{ border-top:2px solid #111; margin-top:6px; padding-top:10px;
                  font-size:16px; font-weight:700; }
  .badge{ display:inline-block; border:1px solid #111; border-radius:4px;
          padding:3px 8px; font-size:11px; font-weight:600; text-transform:uppercase; }
  footer{ margin-top:32px; border-top:1px solid #ddd; padding-top:12px;
          color:#666; font-size:11px; }
  @media print{
    body{ padding:0; }
    .no-print{ display:none; }
    @page{ margin:12mm; }
  }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div>
      <div class="store-name">${escapeHtml(invoice.store.name)}</div>
      ${invoice.store.address ? `<div class="muted">${escapeHtml(invoice.store.address)}</div>` : ""}
      ${invoice.store.phone ? `<div class="muted">${escapeHtml(invoice.store.phone)}</div>` : ""}
      ${invoice.store.email ? `<div class="muted">${escapeHtml(invoice.store.email)}</div>` : ""}
    </div>
    <div>
      <div class="doc-title">INVOICE</div>
      <div class="muted" style="text-align:right">
        <div><strong>${escapeHtml(invoice.invoiceNumber)}</strong></div>
        <div>${new Date(invoice.order.placedAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}</div>
        <div style="margin-top:6px"><span class="badge">${escapeHtml(invoice.order.status)}</span></div>
      </div>
    </div>
  </header>

  <div class="grid">
    <div>
      <h2>Bill to</h2>
      <div><strong>${escapeHtml(invoice.customer.name)}</strong></div>
      <div>${escapeHtml(invoice.customer.phone)}</div>
      <div>${escapeHtml(invoice.customer.address)}</div>
      <div>${escapeHtml(invoice.customer.area)}</div>
    </div>
    <div>
      <h2>Payment</h2>
      <div>${invoice.order.paymentMethod === "cod" ? "Cash on Delivery" : escapeHtml(invoice.order.paymentMethod)}</div>
      <div class="muted">${invoice.order.paymentStatus === "paid" ? "Paid" : "Unpaid"}</div>
      <div style="margin-top:8px"><strong>Amount due: ${taka(invoice.order.amountDue)}</strong></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Item</th>
        <th class="num">Qty</th>
        <th class="num">Unit</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>${taka(invoice.totals.subtotal)}</span></div>
    <div><span>Delivery (${invoice.customer.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"})</span><span>${
      invoice.totals.deliveryCharge === 0 ? "Free" : taka(invoice.totals.deliveryCharge)
    }</span></div>
    <div class="grand"><span>Grand total</span><span>${taka(invoice.totals.grandTotal)}</span></div>
  </div>

  <footer>
    ${invoice.store.footer ? `<div>${escapeHtml(invoice.store.footer)}</div>` : ""}
    <div>Invoice generated ${new Date(invoice.issuedAt).toLocaleString("en-GB")}</div>
  </footer>
</div>
<script>
  /* Opening the invoice in a new tab from the admin panel should go straight
     to the print dialog; ?autoprint=0 suppresses it for a plain preview. */
  if (!location.search.includes("autoprint=0")) {
    window.addEventListener("load", () => window.print());
  }
</script>
</body>
</html>`;
}
