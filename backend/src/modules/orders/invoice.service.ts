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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An order number or a uuid, as the lookup shape the repository wants. */
function lookupFor(orderIdOrNumber: string): { id: string } | { orderNumber: string } {
  return UUID_PATTERN.test(orderIdOrNumber)
    ? { id: orderIdOrNumber }
    : { orderNumber: orderIdOrNumber };
}

export async function buildInvoice(orderIdOrNumber: string): Promise<InvoiceDto> {
  const [detail, settings] = await Promise.all([
    findOrderDetail(lookupFor(orderIdOrNumber)),
    getSettings(),
  ]);

  if (!detail) throw new NotFoundError("Order not found.");

  return toInvoiceDto(detail, settings);
}

/**
 * Several invoices in one pass, for the bulk print sheet.
 *
 * Settings are read once rather than per order — they are the same on every
 * invoice in the batch, and fetching them fifty times to print fifty parcels
 * is fifty round trips for one answer.
 *
 * Order is the caller's, not the database's: the admin ticked them in a
 * particular sequence and the printed stack should match the screen. Unknown
 * identifiers are dropped rather than throwing, so one stale selection cannot
 * cost the operator the whole batch.
 */
export async function buildInvoices(identifiers: string[]): Promise<InvoiceDto[]> {
  const settings = await getSettings();
  const details = await Promise.all(
    identifiers.map((identifier) => findOrderDetail(lookupFor(identifier))),
  );

  return details
    .filter((detail): detail is NonNullable<typeof detail> => detail !== null)
    .map((detail) => toInvoiceDto(detail, settings));
}

type OrderDetail = NonNullable<Awaited<ReturnType<typeof findOrderDetail>>>;
type Settings = Awaited<ReturnType<typeof getSettings>>;

function toInvoiceDto(detail: OrderDetail, settings: Settings): InvoiceDto {
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
    /* Explicit arrow, not a bare reference: `map` would pass the index into
       the cost flag. The invoice travels with the parcel — it must never carry
       what the shop paid. */
    items: items.map((item) => toOrderItemDto(item)),
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

/* -------------------------------------------------------------------------- */
/* Bulk sheet                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How many invoices fit on one A4 sheet, as [columns, rows].
 *
 * Only divisors that tile a page evenly are offered. An arbitrary count would
 * leave a ragged last row and, worse, cells of different heights — the pile
 * then cannot be guillotined in two straight cuts, which is how a shop
 * separates forty of these on a Friday night.
 */
const SHEET_LAYOUTS: Record<number, { columns: number; rows: number }> = {
  1: { columns: 1, rows: 1 },
  2: { columns: 1, rows: 2 },
  4: { columns: 2, rows: 2 },
  6: { columns: 2, rows: 3 },
  9: { columns: 3, rows: 3 },
};

export const SHEET_SIZES = Object.keys(SHEET_LAYOUTS).map(Number);

/**
 * Type scale and how many item lines survive, per density.
 *
 * A cell in a 3×3 is 63×92mm — about a playing card. At that size the full
 * item table is unreadable and the things that matter are the order number,
 * the phone number and the amount to collect, so the lines that would crowd
 * them out are collapsed into "+3 more items" instead.
 */
const SHEET_SCALE: Record<number, { font: number; maxItems: number }> = {
  1: { font: 13, maxItems: 40 },
  2: { font: 11, maxItems: 12 },
  4: { font: 9.5, maxItems: 6 },
  6: { font: 8.5, maxItems: 4 },
  9: { font: 7.5, maxItems: 3 },
};

function renderCell(invoice: InvoiceDto, maxItems: number): string {
  const shown = invoice.items.slice(0, maxItems);
  const hidden = invoice.items.length - shown.length;

  const lines = shown
    .map(
      (item) => `
        <div class="line">
          <span class="line-name">${escapeHtml(item.productName)}${
            item.variantLabel ? ` <span class="dim">(${escapeHtml(item.variantLabel)})</span>` : ""
          }</span>
          <span class="line-qty">×${item.quantity}</span>
          <span class="line-total">${taka(item.lineTotal)}</span>
        </div>`,
    )
    .join("");

  return `
  <article class="cell">
    <div class="cell-head">
      <div class="shop">${escapeHtml(invoice.store.name)}</div>
      <div class="onum">${escapeHtml(invoice.invoiceNumber)}</div>
    </div>

    <div class="who">
      <div class="cname">${escapeHtml(invoice.customer.name)}</div>
      <div class="cphone">${escapeHtml(invoice.customer.phone)}</div>
      <div class="dim addr">${escapeHtml(invoice.customer.address)}, ${escapeHtml(
        invoice.customer.area,
      )}</div>
    </div>

    <div class="lines">
      ${lines}
      ${hidden > 0 ? `<div class="dim more">+${hidden} more item${hidden === 1 ? "" : "s"}</div>` : ""}
    </div>

    <div class="pay">
      <span class="dim">${
        invoice.customer.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"
      } · ${invoice.order.paymentMethod === "cod" ? "COD" : escapeHtml(invoice.order.paymentMethod)}</span>
      <span class="due">${
        invoice.order.paymentStatus === "paid" ? "PAID" : taka(invoice.order.amountDue)
      }</span>
    </div>
  </article>`;
}

/**
 * Renders many invoices tiled onto A4 sheets.
 *
 * A separate template from the single invoice rather than a variant of it: at
 * four to a page there is no room for a bordered item table, a totals block
 * and a footer, and squeezing that layout down produces something legible to
 * nobody. This one keeps what a person packing a parcel and a rider collecting
 * cash actually read — order number, name, phone, address, contents, amount —
 * and drops the rest.
 */
export function renderInvoiceSheetHtml(invoices: InvoiceDto[], perSheet: number): string {
  const layout = SHEET_LAYOUTS[perSheet] ?? SHEET_LAYOUTS[4]!;
  const scale = SHEET_SCALE[perSheet] ?? SHEET_SCALE[4]!;

  const sheets: string[] = [];
  for (let i = 0; i < invoices.length; i += perSheet) {
    const cells = invoices
      .slice(i, i + perSheet)
      .map((invoice) => renderCell(invoice, scale.maxItems))
      .join("");
    sheets.push(`<section class="sheet">${cells}</section>`);
  }

  const count = invoices.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${count} invoice${count === 1 ? "" : "s"}</title>
<style>
  *{ box-sizing: border-box; }
  html,body{ margin:0; padding:0; }
  body{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif;
        color:#111; background:#e9e9ec; font-size:${scale.font}px; line-height:1.35; }

  /* A4 less an 8mm printer margin. Fixed rather than fluid so a cell is the
     same size on screen as on paper — this sheet gets cut up with scissors. */
  .sheet{
    width:194mm; height:281mm; margin:0 auto 8mm; padding:0; background:#fff;
    display:grid;
    grid-template-columns:repeat(${layout.columns}, 1fr);
    grid-template-rows:repeat(${layout.rows}, 1fr);
    box-shadow:0 1px 6px rgba(0,0,0,.18);
  }

  .cell{
    border:1px dashed #bbb; margin:-0.5px; padding:3.5mm;
    display:flex; flex-direction:column; gap:2mm; overflow:hidden;
  }
  .cell-head{ display:flex; justify-content:space-between; align-items:baseline;
              gap:3mm; border-bottom:1px solid #111; padding-bottom:1.5mm; }
  .shop{ font-weight:700; letter-spacing:-0.01em; }
  .onum{ font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }

  .cname{ font-weight:600; }
  .cphone{ font-weight:700; font-variant-numeric:tabular-nums; font-size:1.15em; }
  .addr{ margin-top:0.5mm; }
  .dim{ color:#666; font-weight:400; }

  /* Takes the slack, so the amount block stays pinned to the bottom edge of
     every cell however many lines the order has. */
  .lines{ flex:1; min-height:0; overflow:hidden; border-top:1px solid #eee; padding-top:1.5mm; }
  .line{ display:flex; gap:2mm; align-items:baseline; }
  .line-name{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .line-qty{ font-variant-numeric:tabular-nums; white-space:nowrap; }
  .line-total{ font-variant-numeric:tabular-nums; white-space:nowrap; min-width:14mm;
               text-align:right; }
  .more{ margin-top:0.5mm; }

  .pay{ display:flex; justify-content:space-between; align-items:baseline; gap:2mm;
        border-top:2px solid #111; padding-top:1.5mm; }
  .due{ font-weight:700; font-size:1.45em; font-variant-numeric:tabular-nums;
        white-space:nowrap; }

  .bar{ position:sticky; top:0; z-index:1; display:flex; flex-wrap:wrap; gap:12px;
        align-items:center; justify-content:center; padding:10px;
        background:#111; color:#fff; font-size:13px; }
  .bar button{ font:inherit; padding:6px 14px; border:0; border-radius:4px;
               background:#fff; color:#111; font-weight:600; cursor:pointer; }
  .bar a{ color:#fff; }

  @media print{
    body{ background:#fff; }
    .no-print{ display:none; }
    /* Dashed guides are for cutting; they should not eat toner on every sheet
       edge, but they do have to be visible. */
    .cell{ border-color:#ccc; }
    .sheet{ margin:0; box-shadow:none; page-break-after:always; break-after:page; }
    .sheet:last-child{ page-break-after:auto; break-after:auto; }
    @page{ size:A4; margin:8mm; }
  }
</style>
</head>
<body>
<div class="bar no-print">
  <span>${count} invoice${count === 1 ? "" : "s"} · ${perSheet} per A4 sheet · ${sheets.length} sheet${
    sheets.length === 1 ? "" : "s"
  }</span>
  <button type="button" onclick="window.print()">Print</button>
  <span id="density">${SHEET_SIZES.map(
    (size) => `<a data-per="${size}" href="#">${size}-up</a>`,
  ).join(" · ")}</span>
</div>
${sheets.join("\n")}
<script>
  /* The density links keep whatever else is in the query - above all the id
     list, without which the next page would render an empty sheet. Built here
     rather than server-side so the orders do not have to be threaded into the
     template a second time. (No backticks in this comment: it lives inside a
     template literal.) */
  document.querySelectorAll("#density a").forEach(function (link) {
    var url = new URL(location.href);
    url.searchParams.set("per", link.dataset.per);
    url.searchParams.set("keep", "1");
    link.href = url.pathname + url.search;
  });

  /* Straight to the print dialog, as with a single invoice — unless the page
     was reached by changing the density from the bar above, where another
     dialog on every click would be intolerable. */
  var q = location.search;
  if (!q.includes("autoprint=0") && !q.includes("keep=1")) {
    window.addEventListener("load", function () { window.print(); });
  }
</script>
</body>
</html>`;
}
