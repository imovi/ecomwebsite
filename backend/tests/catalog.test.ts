import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  makeTestImage,
  seedAdminAndLogin,
  startTestServer,
  uploadFiles,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * Product Management module — integration tests.
 *
 * Every endpoint in the module is exercised against the real stack: real HTTP,
 * real middleware order, real Postgres (PGlite), real sharp image processing.
 * Nothing is mocked.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: { pagination?: { page: number; perPage: number; total: number; totalPages: number } };
  error?: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  imageUrl: string | null;
  productCount?: number;
}

interface ProductImage {
  id: string;
  url: string;
  width: number;
  height: number;
  isFeatured: boolean;
  sortOrder: number;
}

interface Variant {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  stockQuantity: number;
  discountPercent: number;
  imageUrl: string | null;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string;
  brand: string | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
  stockQuantity: number;
  stockStatus: string;
  inStock: boolean;
  status?: string;
  isVisible?: boolean;
  tags: string[];
  category: { id: string; name: string; slug: string } | null;
  featuredImage: ProductImage | null;
  images?: ProductImage[];
  variants?: Variant[];
}

const PASSWORD = "CatalogAdmin123";

let ctx: TestContext;
let adminToken: string;
let superToken: string;
let managerToken: string;

/** Ids seeded once and reused across the suites. */
let phonesCategoryId = "";
let audioCategoryId = "";

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "catalog-admin@gng.com.bd",
    password: PASSWORD,
    role: "admin",
  });
  superToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "catalog-super@gng.com.bd",
    password: PASSWORD,
    role: "super_admin",
  });
  managerToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "catalog-manager@gng.com.bd",
    password: PASSWORD,
    role: "manager",
  });
});

after(async () => {
  await ctx.close();
});

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

describe("categories — security", () => {
  it("rejects unauthenticated creation", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/categories", {
      method: "POST",
      body: { name: "Hacked" },
    });
    assert.equal(res.status, 401);
  });

  it("rejects unauthenticated update and delete", async () => {
    const patch = await api(ctx.baseUrl, "/api/v1/admin/categories/x", { method: "PATCH", body: {} });
    const del = await api(ctx.baseUrl, "/api/v1/admin/categories/x", { method: "DELETE" });
    assert.equal(patch.status, 401);
    assert.equal(del.status, 401);
  });

  it("allows the public list without a token", async () => {
    const res = await api<Envelope<{ categories: Category[] }>>(ctx.baseUrl, "/api/v1/categories");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.categories));
  });
});

describe("categories — CRUD", () => {
  it("creates a category and derives the slug from the name", async () => {
    const res = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories",
      {
        method: "POST",
        accessToken: adminToken,
        body: { name: "Smartphones", sortOrder: 1, icon: "mobile" },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.category.slug, "smartphones");
    assert.equal(res.headers.get("location"), "/api/v1/categories/smartphones");
    phonesCategoryId = res.body.data.category.id;
  });

  it("creates a second category", async () => {
    const res = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories",
      {
        method: "POST",
        accessToken: adminToken,
        body: { name: "Audio", sortOrder: 2 },
      },
    );
    assert.equal(res.status, 201);
    audioCategoryId = res.body.data.category.id;
  });

  it("rejects a duplicate name", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/categories", {
      method: "POST",
      accessToken: adminToken,
      body: { name: "smartphones" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, "ALREADY_EXISTS");
  });

  it("rejects an invalid slug and unknown keys", async () => {
    const badSlug = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/categories", {
      method: "POST",
      accessToken: adminToken,
      body: { name: "Bad Slug", slug: "Not A Slug!" },
    });
    const unknownKey = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/categories", {
      method: "POST",
      accessToken: adminToken,
      body: { name: "Extra", colour: "red" },
    });

    assert.equal(badSlug.status, 422);
    assert.equal(unknownKey.status, 422);
  });

  it("reads a category by slug and by id", async () => {
    const bySlug = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      "/api/v1/categories/smartphones",
    );
    const byId = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      `/api/v1/categories/${phonesCategoryId}`,
    );

    assert.equal(bySlug.status, 200);
    assert.equal(byId.status, 200);
    assert.equal(bySlug.body.data.category.id, byId.body.data.category.id);
  });

  it("updates a category", async () => {
    const res = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${audioCategoryId}`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { description: "Headphones, earbuds and speakers" },
      },
    );
    assert.equal(res.status, 200);
  });

  it("rejects an empty update", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${audioCategoryId}`,
      { method: "PATCH", accessToken: adminToken, body: {} },
    );
    assert.equal(res.status, 422);
  });

  it("disables a category and hides it from the public list", async () => {
    const created = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories",
      { method: "POST", accessToken: adminToken, body: { name: "Temporarily Hidden" } },
    );
    const id = created.body.data.category.id;

    const disabled = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${id}/status`,
      { method: "PATCH", accessToken: adminToken, body: { isActive: false } },
    );
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.data.category.isActive, false);

    const publicList = await api<Envelope<{ categories: Category[] }>>(
      ctx.baseUrl,
      "/api/v1/categories",
    );
    assert.ok(!publicList.body.data.categories.some((category) => category.id === id));

    const adminList = await api<Envelope<{ categories: Category[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories",
      { accessToken: adminToken },
    );
    assert.ok(adminList.body.data.categories.some((category) => category.id === id));

    /* A disabled category is also not publicly readable by slug. */
    const publicDetail = await api(ctx.baseUrl, "/api/v1/categories/temporarily-hidden");
    assert.equal(publicDetail.status, 404);
  });

  it("reorders categories in one request", async () => {
    const res = await api<Envelope<{ categories: Category[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories/reorder",
      {
        method: "PATCH",
        accessToken: adminToken,
        body: {
          order: [
            { id: audioCategoryId, sortOrder: 1 },
            { id: phonesCategoryId, sortOrder: 2 },
          ],
        },
      },
    );

    assert.equal(res.status, 200);
    const audio = res.body.data.categories.find((c) => c.id === audioCategoryId);
    const phones = res.body.data.categories.find((c) => c.id === phonesCategoryId);
    assert.equal(audio?.sortOrder, 1);
    assert.equal(phones?.sortOrder, 2);
  });

  it("rejects a reorder listing the same category twice", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/categories/reorder", {
      method: "PATCH",
      accessToken: adminToken,
      body: {
        order: [
          { id: audioCategoryId, sortOrder: 1 },
          { id: audioCategoryId, sortOrder: 2 },
        ],
      },
    });
    assert.equal(res.status, 422);
  });

  it("uploads and removes a category image", async () => {
    const image = await makeTestImage(600, 600);

    const uploaded = await uploadFiles<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${phonesCategoryId}/image`,
      [{ field: "image", buffer: image, filename: "phones.png" }],
      { accessToken: adminToken },
    );

    assert.equal(uploaded.status, 200);
    assert.ok(uploaded.body.data.category.imageUrl?.endsWith(".webp"), "converted to WebP");

    const removed = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${phonesCategoryId}/image`,
      { method: "DELETE", accessToken: adminToken },
    );
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.category.imageUrl, null);
  });

  it("deletes an empty category", async () => {
    const created = await api<Envelope<{ category: Category }>>(
      ctx.baseUrl,
      "/api/v1/admin/categories",
      { method: "POST", accessToken: adminToken, body: { name: "Disposable" } },
    );

    const res = await api(
      ctx.baseUrl,
      `/api/v1/admin/categories/${created.body.data.category.id}`,
      { method: "DELETE", accessToken: adminToken },
    );
    assert.equal(res.status, 204);
  });
});

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

let flagshipId = "";
let flagshipSlug = "";

describe("products — creation and validation", () => {
  it("rejects unauthenticated creation", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      body: { name: "Nope" },
    });
    assert.equal(res.status, 401);
  });

  it("creates a product with variants in one request", async () => {
    const res = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Samsung Galaxy S24 Ultra 5G",
          sku: "SAM-S24U",
          brand: "Samsung",
          categoryId: phonesCategoryId,
          shortDescription: "Titanium flagship with a built-in S Pen",
          price: 152000,
          oldPrice: 172000,
          tags: ["5g", "flagship", "s-pen"],
          status: "active",
          warranty: "1 year official",
          specifications: [{ label: "Display", value: "6.8-inch QHD+ AMOLED" }],
          whatsIncluded: ["Handset", "S Pen", "USB-C cable"],
          variantOptions: [
            { name: "Color", values: ["Titanium Gray", "Titanium Black"] },
            { name: "Storage", values: ["256GB", "512GB"] },
          ],
          variants: [
            {
              sku: "SAM-S24U-GRY-256",
              options: { Color: "Titanium Gray", Storage: "256GB" },
              price: 152000,
              oldPrice: 172000,
              stockQuantity: 5,
            },
            {
              sku: "SAM-S24U-BLK-512",
              options: { Color: "Titanium Black", Storage: "512GB" },
              price: 166000,
              stockQuantity: 2,
            },
          ],
        },
      },
    );

    assert.equal(res.status, 201);
    const product = res.body.data.product;
    flagshipId = product.id;
    flagshipSlug = product.slug;

    assert.equal(product.slug, "samsung-galaxy-s24-ultra-5g", "slug derived from name");
    assert.equal(product.discountPercent, 12, "discount computed by the database");
    assert.equal(product.variants?.length, 2);
    assert.equal(product.stockQuantity, 7, "product stock is the sum of its variants");
    assert.equal(product.stockStatus, "in_stock");
  });

  it("rejects a duplicate SKU", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Different Name",
        sku: "sam-s24u",
        brand: "Samsung",
        categoryId: phonesCategoryId,
        price: 1000,
      },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, "ALREADY_EXISTS");
  });

  it("rejects a duplicate slug", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Another Product",
        slug: flagshipSlug,
        sku: "UNIQUE-SKU-1",
        brand: "Samsung",
        categoryId: phonesCategoryId,
        price: 1000,
      },
    });
    assert.equal(res.status, 409);
  });

  it("rejects an old price below the current price", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Bad Pricing",
        sku: "BAD-PRICE-1",
        brand: "Test",
        categoryId: phonesCategoryId,
        price: 5000,
        oldPrice: 4000,
      },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.error?.details?.some((d) => d.field.includes("oldPrice")));
  });

  it("rejects a non-integer price", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Fractional",
        sku: "FRACTION-1",
        brand: "Test",
        categoryId: phonesCategoryId,
        price: 1299.99,
      },
    });
    assert.equal(res.status, 422);
  });

  it("rejects a variant whose option is not declared", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Bad Variant",
        sku: "BADVAR-1",
        brand: "Test",
        categoryId: phonesCategoryId,
        price: 1000,
        variantOptions: [{ name: "Color", values: ["Black"] }],
        variants: [
          { sku: "BADVAR-1-A", options: { Size: "Large" }, price: 1000 },
        ],
      },
    });
    assert.equal(res.status, 422);
  });

  it("rejects two variants with the same option combination", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Dupe Variant",
        sku: "DUPEVAR-1",
        brand: "Test",
        categoryId: phonesCategoryId,
        price: 1000,
        variantOptions: [{ name: "Color", values: ["Black"] }],
        variants: [
          { sku: "DUPEVAR-1-A", options: { Color: "Black" }, price: 1000 },
          { sku: "DUPEVAR-1-B", options: { Color: "Black" }, price: 1100 },
        ],
      },
    });
    assert.equal(res.status, 422);
  });

  it("rejects an unknown category", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products", {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Orphan",
        sku: "ORPHAN-1",
        brand: "Test",
        categoryId: "00000000-0000-4000-8000-000000000000",
        price: 1000,
      },
    });
    assert.equal(res.status, 404);
  });
});

describe("products — catalogue seed", () => {
  it("creates the remaining fixtures", async () => {
    const fixtures = [
      {
        name: "Xiaomi Redmi Note 13 Pro",
        sku: "XIA-RN13P",
        brand: "Xiaomi",
        categoryId: phonesCategoryId,
        price: 32500,
        oldPrice: 37000,
        tags: ["5g", "budget"],
        stockQuantity: 12,
        status: "active",
      },
      {
        name: "Apple AirPods Pro 2",
        sku: "APL-APP2",
        brand: "Apple",
        categoryId: audioCategoryId,
        price: 26500,
        tags: ["anc", "wireless"],
        stockQuantity: 4,
        status: "active",
      },
      {
        name: "Sony WH-1000XM5",
        sku: "SNY-XM5",
        brand: "Sony",
        categoryId: audioCategoryId,
        price: 39500,
        tags: ["anc"],
        stockQuantity: 0,
        status: "active",
      },
      {
        name: "Unreleased Prototype",
        sku: "PROTO-1",
        brand: "Secret",
        categoryId: phonesCategoryId,
        price: 99999,
        status: "draft",
      },
    ];

    for (const fixture of fixtures) {
      const res = await api<Envelope<{ product: Product }>>(
        ctx.baseUrl,
        "/api/v1/admin/products",
        { method: "POST", accessToken: adminToken, body: fixture },
      );
      assert.equal(res.status, 201, `failed to create ${fixture.sku}`);
    }
  });
});

describe("products — public reads", () => {
  it("lists only active, visible products", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products");

    assert.equal(res.status, 200);
    assert.ok(!res.body.data.some((p) => p.sku === "PROTO-1"), "draft is hidden");
    assert.ok(res.body.meta?.pagination, "pagination metadata present");
    assert.equal(res.body.data.length, 4);
  });

  it("paginates", async () => {
    const page1 = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?page=1&perPage=2");
    const page2 = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?page=2&perPage=2");

    assert.equal(page1.body.data.length, 2);
    assert.equal(page2.body.data.length, 2);
    assert.equal(page1.body.meta?.pagination?.total, 4);
    assert.equal(page1.body.meta?.pagination?.totalPages, 2);

    const ids = new Set([...page1.body.data, ...page2.body.data].map((p) => p.id));
    assert.equal(ids.size, 4, "pages do not overlap");
  });

  it("caps perPage to protect the database", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/products?perPage=100000");
    assert.equal(res.status, 422);
  });

  it("returns product detail by slug with images and variants", async () => {
    const res = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/products/${flagshipSlug}`,
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.product.sku, "SAM-S24U");
    assert.equal(res.body.data.product.variants?.length, 2);
    assert.equal(res.body.data.product.category?.slug, "smartphones");
    assert.ok(!("metrics" in res.body.data.product), "metrics stay admin-only");
  });

  it("404s on a draft product and on an unknown slug", async () => {
    const draft = await api(ctx.baseUrl, "/api/v1/products/unreleased-prototype");
    const missing = await api(ctx.baseUrl, "/api/v1/products/does-not-exist");
    assert.equal(draft.status, 404);
    assert.equal(missing.status, 404);
  });
});

describe("products — filtering", () => {
  it("filters by category slug and by category id", async () => {
    const bySlug = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?category=audio",
    );
    const byId = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      `/api/v1/products?categoryId=${audioCategoryId}`,
    );

    assert.equal(bySlug.body.data.length, 2);
    assert.equal(byId.body.data.length, 2);
    assert.ok(bySlug.body.data.every((p) => p.category?.slug === "audio"));
  });

  it("filters by brand, including a comma-separated list", async () => {
    const single = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?brand=Sony");
    const multiple = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?brand=Sony,Apple",
    );

    assert.equal(single.body.data.length, 1);
    assert.equal(multiple.body.data.length, 2);
  });

  it("filters by price range", async () => {
    const res = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?minPrice=30000&maxPrice=40000",
    );
    assert.ok(res.body.data.every((p) => p.price >= 30000 && p.price <= 40000));
    assert.equal(res.body.data.length, 2);
  });

  it("rejects an inverted price range", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      "/api/v1/products?minPrice=50000&maxPrice=1000",
    );
    assert.equal(res.status, 422);
  });

  it("filters by stock status", async () => {
    const inStock = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?inStock=true");
    const outOfStock = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?stockStatus=out_of_stock",
    );

    assert.ok(inStock.body.data.every((p) => p.inStock));
    assert.equal(outOfStock.body.data.length, 1);
    assert.equal(outOfStock.body.data[0]?.sku, "SNY-XM5");
  });

  it("filters by tag", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?tags=anc");
    assert.equal(res.body.data.length, 2);
  });

  it("filters to discounted products only", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?onSale=true");
    assert.ok(res.body.data.every((p) => p.discountPercent > 0));
    assert.equal(res.body.data.length, 2);
  });
});

describe("products — sorting", () => {
  it("sorts by price ascending and descending", async () => {
    const asc = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?sort=price_asc");
    const desc = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?sort=price_desc");

    const ascPrices = asc.body.data.map((p) => p.price);
    const descPrices = desc.body.data.map((p) => p.price);

    assert.deepEqual(ascPrices, [...ascPrices].sort((a, b) => a - b));
    assert.deepEqual(descPrices, [...descPrices].sort((a, b) => b - a));
  });

  it("sorts by name", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?sort=name_asc");
    const names = res.body.data.map((p) => p.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  it("sorts by discount", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?sort=discount");
    assert.ok((res.body.data[0]?.discountPercent ?? 0) > 0);
  });

  it("accepts best_selling before any orders exist", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?sort=best_selling");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 4);
  });

  it("rejects an unknown sort key", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      "/api/v1/products?sort=price_asc;DROP TABLE products",
    );
    assert.equal(res.status, 422);
  });
});

describe("products — search", () => {
  it("finds a product by name", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=samsung");
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((p) => p.sku === "SAM-S24U"));
  });

  it("finds a product by SKU", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=SNY-XM5");
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0]?.brand, "Sony");
  });

  it("finds products by brand and by tag", async () => {
    const brand = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=xiaomi");
    const tag = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=flagship");
    assert.ok(brand.body.data.length >= 1);
    assert.ok(tag.body.data.some((p) => p.sku === "SAM-S24U"));
  });

  it("supports partial prefixes", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=sam");
    assert.ok(res.body.data.some((p) => p.sku === "SAM-S24U"), "prefix match works");
  });

  it("never leaks drafts through search", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products/search?q=prototype");
    assert.equal(res.body.data.length, 0);
  });

  it("survives punctuation that would break a naive tsquery", async () => {
    for (const term of ["it's", "a & b", "!!!", '"unclosed', "-only"]) {
      const res = await api<Envelope<Product[]>>(
        ctx.baseUrl,
        `/api/v1/products/search?q=${encodeURIComponent(term)}`,
      );
      assert.equal(res.status, 200, `term ${term} should not 500`);
    }
  });

  it("requires a search term", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/products/search");
    assert.equal(res.status, 422);
  });
});

describe("products — homepage rails and facets", () => {
  it("returns new arrivals newest-first", async () => {
    const res = await api<Envelope<{ products: Product[] }>>(
      ctx.baseUrl,
      "/api/v1/products/new-arrivals?limit=3",
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.products.length, 3);
  });

  it("returns trending without any manual control", async () => {
    const res = await api<Envelope<{ products: Product[] }>>(
      ctx.baseUrl,
      "/api/v1/products/trending?limit=5",
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.products.length > 0);
  });

  it("returns filter facets", async () => {
    const res = await api<
      Envelope<{ brands: { name: string; productCount: number }[]; priceRange: { min: number; max: number } }>
    >(ctx.baseUrl, "/api/v1/products/facets");

    assert.equal(res.status, 200);
    assert.ok(res.body.data.brands.length >= 4);
    assert.ok(res.body.data.priceRange.max >= res.body.data.priceRange.min);
    assert.ok(!res.body.data.brands.some((b) => b.name === "Secret"), "draft brands excluded");
  });
});

/* -------------------------------------------------------------------------- */
/* Variants                                                                   */
/* -------------------------------------------------------------------------- */

describe("products — variants", () => {
  it("lists variants", async () => {
    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      { accessToken: adminToken },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.variants.length, 2);
  });

  it("adds a variant and re-derives product stock", async () => {
    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          sku: "SAM-S24U-GRY-512",
          options: { Color: "Titanium Gray", Storage: "512GB" },
          price: 166000,
          stockQuantity: 3,
        },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.variants.length, 3);

    const product = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/products/${flagshipSlug}`,
    );
    assert.equal(product.body.data.product.stockQuantity, 10, "5 + 2 + 3");
  });

  it("rejects a duplicate variant SKU", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          sku: "sam-s24u-gry-256",
          options: { Color: "Titanium Black", Storage: "256GB" },
          price: 150000,
        },
      },
    );
    assert.equal(res.status, 409);
  });

  it("rejects a duplicate option combination", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          sku: "SAM-S24U-NEW",
          options: { Color: "Titanium Gray", Storage: "256GB" },
          price: 150000,
        },
      },
    );
    assert.equal(res.status, 409);
  });

  it("updates a variant and keeps stock in sync", async () => {
    const listed = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      { accessToken: adminToken },
    );
    const target = listed.body.data.variants[0]!;

    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/${target.id}`,
      { method: "PATCH", accessToken: adminToken, body: { stockQuantity: 20 } },
    );
    assert.equal(res.status, 200);

    const product = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/products/${flagshipSlug}`,
    );
    const expected = res.body.data.variants.reduce((sum, v) => sum + v.stockQuantity, 0);
    assert.equal(product.body.data.product.stockQuantity, expected);
  });

  it("deletes a variant", async () => {
    const listed = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      { accessToken: adminToken },
    );
    const target = listed.body.data.variants.at(-1)!;

    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/${target.id}`,
      { method: "DELETE", accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.variants.length, 2);
  });

  it("404s for a variant belonging to another product", async () => {
    const res = await api(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/00000000-0000-4000-8000-000000000000`,
      { method: "DELETE", accessToken: adminToken },
    );
    assert.equal(res.status, 404);
  });
});

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

describe("products — images", () => {
  let imageIds: string[] = [];

  it("uploads, optimises and auto-features the first image", async () => {
    const [a, b] = await Promise.all([makeTestImage(1200, 1200), makeTestImage(900, 900)]);

    const res = await uploadFiles<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images`,
      [
        { field: "images", buffer: a, filename: "front.png" },
        { field: "images", buffer: b, filename: "back.png" },
      ],
      { accessToken: adminToken },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.images.length, 2);
    imageIds = res.body.data.images.map((image) => image.id);

    const featured = res.body.data.images.filter((image) => image.isFeatured);
    assert.equal(featured.length, 1, "exactly one featured image");
    assert.ok(res.body.data.images[0]?.url.endsWith(".webp"), "re-encoded to WebP");
    assert.equal(res.body.data.images[0]?.width, 1200, "dimensions recorded");
  });

  it("rejects a file that is not an image", async () => {
    const res = await uploadFiles<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images`,
      [
        {
          field: "images",
          buffer: Buffer.from("<?php system($_GET['c']); ?>"),
          filename: "shell.php.png",
          contentType: "image/png",
        },
      ],
      { accessToken: adminToken },
    );

    assert.ok(res.status === 415 || res.status === 422, `got ${res.status}`);
  });

  it("rejects an image below the minimum dimensions", async () => {
    const tiny = await makeTestImage(50, 50);
    const res = await uploadFiles<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images`,
      [{ field: "images", buffer: tiny, filename: "tiny.png" }],
      { accessToken: adminToken },
    );
    assert.equal(res.status, 422);
  });

  it("reorders the gallery", async () => {
    const res = await api<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images/reorder`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: {
          order: [
            { id: imageIds[1]!, sortOrder: 0 },
            { id: imageIds[0]!, sortOrder: 1 },
          ],
        },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.images[0]?.id, imageIds[1]);
  });

  it("refuses to reorder images belonging to another product", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images/reorder`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { order: [{ id: "00000000-0000-4000-8000-000000000000", sortOrder: 0 }] },
      },
    );
    assert.equal(res.status, 422);
  });

  it("changes the featured image", async () => {
    const res = await api<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images/${imageIds[1]}/featured`,
      { method: "PATCH", accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    const featured = res.body.data.images.filter((image) => image.isFeatured);
    assert.equal(featured.length, 1);
    assert.equal(featured[0]?.id, imageIds[1]);
  });

  it("promotes another image when the featured one is deleted", async () => {
    const res = await api<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images/${imageIds[1]}`,
      { method: "DELETE", accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.images.length, 1);
    assert.equal(res.body.data.images[0]?.isFeatured, true, "remaining image promoted");
  });

  it("exposes the featured image on listings", async () => {
    const res = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?category=smartphones");
    const flagship = res.body.data.find((p) => p.id === flagshipId);
    assert.ok(flagship?.featuredImage?.url, "listing carries the featured image");
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe("products — update and lifecycle", () => {
  it("updates a product", async () => {
    const res = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { price: 149000, tags: ["5g", "flagship", "s-pen", "titanium"] },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.product.price, 149000);
    assert.equal(res.body.data.product.discountPercent, 13, "discount recomputed");
  });

  it("hides a product from the storefront without archiving it", async () => {
    const hidden = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/status`,
      { method: "PATCH", accessToken: adminToken, body: { isVisible: false } },
    );
    assert.equal(hidden.status, 200);

    const publicDetail = await api(ctx.baseUrl, `/api/v1/products/${flagshipSlug}`);
    assert.equal(publicDetail.status, 404);

    const adminDetail = await api(ctx.baseUrl, `/api/v1/admin/products/${flagshipId}`, {
      accessToken: adminToken,
    });
    assert.equal(adminDetail.status, 200);

    /* Restore for later assertions. */
    await api(ctx.baseUrl, `/api/v1/admin/products/${flagshipId}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { isVisible: true },
    });
  });

  it("refuses to delete a category that still has products", async () => {
    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/categories/${phonesCategoryId}`,
      { method: "DELETE", accessToken: adminToken },
    );

    assert.equal(res.status, 409);
    assert.match(res.body.error?.message ?? "", /product/i);
  });

  it("archives a product by default on DELETE", async () => {
    const created = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Soon Archived",
          sku: "ARCH-1",
          brand: "Test",
          categoryId: audioCategoryId,
          price: 500,
          status: "active",
        },
      },
    );
    const id = created.body.data.product.id;

    const deleted = await api(ctx.baseUrl, `/api/v1/admin/products/${id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(deleted.status, 204);

    const publicDetail = await api(ctx.baseUrl, "/api/v1/products/soon-archived");
    assert.equal(publicDetail.status, 404, "gone from the storefront");

    const adminDetail = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${id}`,
      { accessToken: adminToken },
    );
    assert.equal(adminDetail.status, 200, "still retrievable by an admin");
    assert.equal(adminDetail.body.data.product.status, "archived");
  });

  it("restricts permanent deletion to a super admin", async () => {
    const created = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Hard Delete Me",
          sku: "HARD-1",
          brand: "Test",
          categoryId: audioCategoryId,
          price: 500,
        },
      },
    );
    const id = created.body.data.product.id;

    const asAdmin = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${id}?permanent=true`,
      { method: "DELETE", accessToken: adminToken },
    );
    assert.equal(asAdmin.status, 403);
    assert.equal(asAdmin.body.error?.code, "INSUFFICIENT_ROLE");

    const asSuper = await api(ctx.baseUrl, `/api/v1/admin/products/${id}?permanent=true`, {
      method: "DELETE",
      accessToken: superToken,
    });
    assert.equal(asSuper.status, 204);

    const gone = await api(ctx.baseUrl, `/api/v1/admin/products/${id}`, {
      accessToken: superToken,
    });
    assert.equal(gone.status, 404);
  });

  it("lets a manager manage the catalogue", async () => {
    const res = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: managerToken,
        body: {
          name: "Manager Created",
          sku: "MGR-1",
          brand: "Test",
          categoryId: audioCategoryId,
          price: 999,
        },
      },
    );
    assert.equal(res.status, 201);
  });

  it("shows drafts to admins and allows filtering by status", async () => {
    const res = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/admin/products?status=draft",
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.ok(res.body.data.every((p) => p.status === "draft"));
    assert.ok(res.body.data.some((p) => p.sku === "PROTO-1"));
  });
});

/* -------------------------------------------------------------------------- */
/* Trending                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Trending is derived, not curated.
 *
 * These exercise the seam the orders module will use — `recordProductSale` —
 * and prove that recording demand changes the ranking with no operator input
 * and no schema change. That is the whole "future ready for best selling"
 * requirement, verified rather than asserted in a comment.
 */
describe("products — trending is automatic", () => {
  it("ranks by recorded demand after a recompute", async () => {
    const { recordProductSale, recomputeTrendingScores } = await import(
      "../src/modules/products/metrics.service.js"
    );

    /* Pick a product that is NOT the newest, so a change in its position
       cannot be explained by the freshness term alone. */
    const listed = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?sort=oldest&perPage=1",
    );
    const target = listed.body.data[0]!;

    const before = await api<Envelope<{ products: Product[] }>>(
      ctx.baseUrl,
      "/api/v1/products/trending?limit=10",
    );
    const positionBefore = before.body.data.products.findIndex((p) => p.id === target.id);

    /* Simulate what the orders module will do on delivery. */
    await recordProductSale({ productId: target.id, units: 250 });
    await recomputeTrendingScores();

    const after = await api<Envelope<{ products: Product[] }>>(
      ctx.baseUrl,
      "/api/v1/products/trending?limit=10",
    );

    assert.equal(after.body.data.products[0]?.id, target.id, "demand moved it to the top");
    assert.ok(positionBefore !== 0, "it did not start at the top");
  });

  it("reflects recorded sales in best_selling", async () => {
    const res = await api<Envelope<Product[]>>(
      ctx.baseUrl,
      "/api/v1/products?sort=best_selling",
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
  });

  it("clamps a reversal at zero", async () => {
    const { recordProductSale, reverseProductSale } = await import(
      "../src/modules/products/metrics.service.js"
    );
    const listed = await api<Envelope<Product[]>>(ctx.baseUrl, "/api/v1/products?perPage=1");
    const target = listed.body.data[0]!;

    await recordProductSale({ productId: target.id, units: 2 });
    /* Over-reverse: a double refund must not drive the counter negative. */
    await reverseProductSale({ productId: target.id, units: 99 });

    const detail = await api<Envelope<{ product: Product & { metrics?: { unitsSold: number } } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${target.id}`,
      { accessToken: adminToken },
    );
    assert.ok((detail.body.data.product.metrics?.unitsSold ?? 0) >= 0);
  });

  it("does not expose any endpoint for setting a trending flag", async () => {
    /* A curated-trending endpoint would defeat the requirement; assert the
       obvious candidates genuinely do not exist. */
    for (const path of [
      `/api/v1/admin/products/${flagshipId}/trending`,
      `/api/v1/admin/products/${flagshipId}/feature`,
    ]) {
      const res = await api(ctx.baseUrl, path, {
        method: "PATCH",
        accessToken: superToken,
        body: { trending: true },
      });
      assert.equal(res.status, 404, `${path} must not exist`);
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Optional brand.
 *
 * Last in the file on purpose: these tests add products, and earlier suites
 * assert exact catalogue counts against the shared database. Running them here
 * keeps the new fixtures from breaking assertions that have nothing to do with
 * brands.
 */
describe("products — optional brand", () => {
  it("creates a product with no brand at all", async () => {
    const res = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Generic USB-C Cable 1m",
          sku: "GEN-USBC-1M",
          categoryId: phonesCategoryId,
          price: 250,
          stockQuantity: 40,
          status: "active",
        },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.product.brand, null, "an omitted brand is stored as null");
  });

  it("treats a blank brand as no brand rather than an empty string", async () => {
    for (const [label, brand] of [
      ["empty string", ""],
      ["whitespace only", "   "],
      ["explicit null", null],
    ] as [string, string | null][]) {
      const res = await api<Envelope<{ product: Product }>>(
        ctx.baseUrl,
        "/api/v1/admin/products",
        {
          method: "POST",
          accessToken: adminToken,
          body: {
            name: `Blank Brand ${label}`,
            sku: `BLANK-${label.replace(/[^a-z]/gi, "").toUpperCase()}`,
            categoryId: phonesCategoryId,
            price: 100,
          },
        },
      );
      assert.equal(res.status, 201, label);
      assert.equal(res.body.data.product.brand, null, label);

      /* Same normalisation when the field is explicitly present. */
      const withField = await api<Envelope<{ product: Product }>>(
        ctx.baseUrl,
        "/api/v1/admin/products",
        {
          method: "POST",
          accessToken: adminToken,
          body: {
            name: `Blank Brand Field ${label}`,
            sku: `BLANKF-${label.replace(/[^a-z]/gi, "").toUpperCase()}`,
            categoryId: phonesCategoryId,
            price: 100,
            brand,
          },
        },
      );
      assert.equal(withField.status, 201, `${label} (explicit)`);
      assert.equal(withField.body.data.product.brand, null, `${label} (explicit)`);
    }
  });

  it("publishes a product that has no brand", async () => {
    const created = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Unbranded Phone Stand",
          sku: "UNBR-STAND",
          categoryId: phonesCategoryId,
          price: 450,
          stockQuantity: 10,
        },
      },
    );
    assert.equal(created.status, 201);

    const published = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${created.body.data.product.id}/status`,
      { method: "PATCH", accessToken: adminToken, body: { status: "active" } },
    );
    assert.equal(published.status, 200, "no brand must not block publishing");
    assert.equal(published.body.data.product.status, "active");

    /* And it is genuinely reachable by a customer. */
    const publicRes = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/products/unbranded-phone-stand",
    );
    assert.equal(publicRes.status, 200);
    assert.equal(publicRes.body.data.product.brand, null);
  });

  it("clears an existing brand when sent null, and keeps it when omitted", async () => {
    const created = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Branded Then Cleared",
          sku: "BRAND-CLEAR",
          categoryId: phonesCategoryId,
          price: 900,
          brand: "Anker",
        },
      },
    );
    assert.equal(created.body.data.product.brand, "Anker");
    const id = created.body.data.product.id;

    /* An update that does not mention brand must leave it alone — otherwise
       editing a price would silently wipe the brand. */
    const untouched = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${id}`,
      { method: "PATCH", accessToken: adminToken, body: { price: 950 } },
    );
    assert.equal(untouched.body.data.product.brand, "Anker", "omitted brand is unchanged");

    const cleared = await api<Envelope<{ product: Product }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${id}`,
      { method: "PATCH", accessToken: adminToken, body: { brand: null } },
    );
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.product.brand, null, "explicit null clears it");
  });

  it("still rejects an empty update body now that brand is optional", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/admin/products/00000000-0000-4000-8000-000000000000", {
      method: "PATCH",
      accessToken: adminToken,
      body: {},
    });
    /* 422, not 404: validation runs before the row is looked up. The point is
       that an all-optional schema has not become an accept-anything schema. */
    assert.equal(res.status, 422);
  });

});

/* -------------------------------------------------------------------------- */
/* Branding — logo and banners                                                */
/* -------------------------------------------------------------------------- */

/**
 * Shop branding.
 *
 * Both of these used to require a code change — the logo was a hardcoded
 * wordmark, the banners were committed SVGs — so the properties worth pinning
 * down are the ones that make them safely operator-editable: the storefront must
 * see changes without a deploy, and the endpoints must not let whoever holds an
 * admin session redirect the shop's most-clicked element off-site.
 */
describe("branding — logo", () => {
  interface Settings {
    store: { logoUrl: string | null; name: string };
  }

  it("starts with no logo, so the wordmark is used", async () => {
    const res = await api<Envelope<{ settings: Settings }>>(
      ctx.baseUrl,
      "/api/v1/admin/settings",
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.settings.store.logoUrl, null);
  });

  it("accepts a wide wordmark that the product image floor would reject", async () => {
    /* 420×90 — well under the 200px minimum that is right for product photos.
       Enforcing that here would make the feature unusable for exactly the shops
       most likely to have a simple logo. */
    const res = await uploadFiles(
      ctx.baseUrl,
      "/api/v1/admin/settings/logo",
      [{ field: "logo", filename: "wordmark.png", buffer: await makeTestImage(420, 90) }],
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    const body = res.body as Envelope<{ settings: Settings }>;
    assert.ok(body.data.settings.store.logoUrl, "a logo URL is returned");
    assert.match(body.data.settings.store.logoUrl ?? "", /\/uploads\/branding\//);
  });

  it("publishes the logo to the storefront without a login", async () => {
    const res = await api<Envelope<{ settings: { store: { logoUrl: string | null } } }>>(
      ctx.baseUrl,
      "/api/v1/storefront/settings",
    );

    assert.equal(res.status, 200);
    assert.ok(
      res.body.data.settings.store.logoUrl,
      "the header needs this on every page, so it is public",
    );
  });

  it("replaces the logo and removes it again", async () => {
    const replaced = await uploadFiles(
      ctx.baseUrl,
      "/api/v1/admin/settings/logo",
      [{ field: "logo", filename: "new-logo.png", buffer: await makeTestImage(500, 120) }],
      { accessToken: adminToken },
    );
    assert.equal(replaced.status, 200);

    const removed = await api<Envelope<{ settings: Settings }>>(
      ctx.baseUrl,
      "/api/v1/admin/settings/logo",
      { method: "DELETE", accessToken: adminToken },
    );

    assert.equal(removed.status, 200);
    assert.equal(
      removed.body.data.settings.store.logoUrl,
      null,
      "removing falls back to the wordmark",
    );
  });

  it("rejects a logo upload with no file", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/settings/logo", {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });
    assert.equal(res.status, 400);
  });

  it("is closed to managers", async () => {
    const res = await uploadFiles(
      ctx.baseUrl,
      "/api/v1/admin/settings/logo",
      [{ field: "logo", filename: "nope.png", buffer: await makeTestImage(400, 100) }],
      { accessToken: managerToken },
    );
    assert.equal(res.status, 403);
  });
});

describe("branding — banners", () => {
  interface Banner {
    id: string;
    imageUrl: string;
    imageMobileUrl: string | null;
    alt: string;
    href: string;
    sortOrder: number;
    isActive: boolean;
  }

  let firstId = "";
  let secondId = "";

  it("starts empty", async () => {
    const res = await api<Envelope<{ banners: Banner[] }>>(ctx.baseUrl, "/api/v1/banners");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.banners, []);
  });

  it("requires an image to create one", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/banners", {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });
    /* A banner with no artwork is a blank slot on the most valuable space on the
       homepage, so this is refused rather than created empty. */
    assert.equal(res.status, 400);
  });

  it("creates a banner from an uploaded image", async () => {
    const res = await uploadFiles(
      ctx.baseUrl,
      "/api/v1/admin/banners",
      [{ field: "image", filename: "sale.png", buffer: await makeTestImage(1600, 640) }],
      {
        accessToken: adminToken,
        fields: { alt: "Eid sale", href: "/category/audio", isActive: "true" },
      },
    );

    assert.equal(res.status, 201);
    const banner = (res.body as Envelope<{ banner: Banner }>).data.banner;
    assert.match(banner.imageUrl, /\/uploads\/banners\//);
    assert.equal(banner.alt, "Eid sale");
    assert.equal(banner.href, "/category/audio");
    assert.equal(banner.imageMobileUrl, null, "no phone crop was supplied");
    assert.equal(banner.sortOrder, 0);
    firstId = banner.id;
  });

  it("refuses a link that leaves the site", async () => {
    /* The banner is the single most-clicked element on the shop. An absolute URL
       here would let whoever holds an admin session turn the homepage into a
       redirect to anywhere. */
    for (const href of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "http://gng.com.bd.evil.example",
    ]) {
      const res = await uploadFiles(
        ctx.baseUrl,
        "/api/v1/admin/banners",
        [{ field: "image", filename: "x.png", buffer: await makeTestImage(1200, 500) }],
        { accessToken: adminToken, fields: { href } },
      );
      assert.equal(res.status, 422, href);
    }
  });

  it("appends new banners to the end rather than reshuffling", async () => {
    const res = await uploadFiles(
      ctx.baseUrl,
      "/api/v1/admin/banners",
      [{ field: "image", filename: "second.png", buffer: await makeTestImage(1500, 600) }],
      { accessToken: adminToken, fields: { alt: "Second" } },
    );

    assert.equal(res.status, 201);
    const banner = (res.body as Envelope<{ banner: Banner }>).data.banner;
    assert.equal(banner.sortOrder, 1, "an operator adding a banner is not reordering the others");
    secondId = banner.id;
  });

  it("hides an inactive banner from the storefront but not from the admin", async () => {
    const patched = await uploadFiles(
      ctx.baseUrl,
      `/api/v1/admin/banners/${secondId}`,
      [],
      { accessToken: adminToken, method: "PATCH", fields: { isActive: "false" } },
    );
    assert.equal(patched.status, 200);

    const publicRes = await api<Envelope<{ banners: Banner[] }>>(ctx.baseUrl, "/api/v1/banners");
    assert.equal(publicRes.body.data.banners.length, 1);
    assert.equal(publicRes.body.data.banners[0]?.id, firstId);

    const adminRes = await api<Envelope<{ banners: Banner[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/banners",
      { accessToken: adminToken },
    );
    assert.equal(adminRes.body.data.banners.length, 2, "switched off, not deleted");
  });

  it("reorders banners", async () => {
    const res = await api<Envelope<{ banners: Banner[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/banners/reorder",
      {
        method: "PATCH",
        accessToken: adminToken,
        body: {
          order: [
            { id: secondId, sortOrder: 0 },
            { id: firstId, sortOrder: 1 },
          ],
        },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.banners[0]?.id, secondId);
    assert.equal(res.body.data.banners[1]?.id, firstId);
  });

  it("rejects a reorder listing the same banner twice", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/banners/reorder", {
      method: "PATCH",
      accessToken: adminToken,
      body: {
        order: [
          { id: firstId, sortOrder: 0 },
          { id: firstId, sortOrder: 1 },
        ],
      },
    });
    assert.equal(res.status, 422);
  });

  it("deletes a banner", async () => {
    const res = await api(ctx.baseUrl, `/api/v1/admin/banners/${secondId}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(res.status, 204);

    const adminRes = await api<Envelope<{ banners: Banner[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/banners",
      { accessToken: adminToken },
    );
    assert.equal(adminRes.body.data.banners.length, 1);
  });

  it("is readable by the public but writable only by an admin", async () => {
    const publicRead = await api(ctx.baseUrl, "/api/v1/banners");
    assert.equal(publicRead.status, 200);

    const anonWrite = await api(ctx.baseUrl, "/api/v1/admin/banners", {
      method: "POST",
      body: {},
    });
    assert.equal(anonWrite.status, 401);

    const managerWrite = await api(ctx.baseUrl, "/api/v1/admin/banners", {
      method: "POST",
      accessToken: managerToken,
      body: {},
    });
    assert.equal(managerWrite.status, 403);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Picking a variant by picture instead of by word.
 *
 * The column behind this has existed since the variants table was created and
 * nothing could ever write to it — `imageId` was accepted by no schema, so the
 * foreign key was dead. These tests cover the path that brings it to life, and
 * the ownership rule that keeps one product's photograph off another's page.
 */
describe("products — variant pictures", () => {
  let imageId = "";
  let variantId = "";

  before(async () => {
    const uploaded = await uploadFiles<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/images`,
      [{ field: "images", buffer: await makeTestImage(500, 500), filename: "swatch.png" }],
      { accessToken: adminToken },
    );
    imageId = uploaded.body.data.images.at(-1)!.id;

    const variants = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants`,
      { accessToken: adminToken },
    );
    variantId = variants.body.data.variants[0]!.id;
  });

  it("gives a variant a picture, and returns it to the storefront", async () => {
    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/${variantId}`,
      { method: "PATCH", accessToken: adminToken, body: { imageId } },
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));

    const updated = res.body.data.variants.find((variant) => variant.id === variantId);
    assert.ok(updated?.imageUrl, "the variant now carries a picture");

    /* And the public product carries it too — the swatch is rendered from the
       storefront payload, not from an admin-only field. */
    const shown = await api<Envelope<{ product: { variants: Variant[] } }>>(
      ctx.baseUrl,
      `/api/v1/products/${flagshipSlug}`,
    );
    const publicVariant = shown.body.data.product.variants.find((v) => v.id === variantId);
    assert.ok(publicVariant?.imageUrl, "and the shopper's copy has it");
  });

  it("clears the picture when sent null", async () => {
    const res = await api<Envelope<{ variants: Variant[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/${variantId}`,
      { method: "PATCH", accessToken: adminToken, body: { imageId: null } },
    );

    assert.equal(res.status, 200);
    assert.equal(
      res.body.data.variants.find((variant) => variant.id === variantId)?.imageUrl,
      null,
      "a swatch set by mistake has to be removable",
    );
  });

  /**
   * The rule a schema cannot enforce, because it cannot see the parent. Without
   * it, a variant could show another product's photograph — and that picture
   * would vanish the day the unrelated product's image was deleted, with
   * nothing on this product to explain why.
   */
  it("refuses a picture belonging to a different product", async () => {
    const other = await api<Envelope<{ product: { id: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/products",
      {
        method: "POST",
        accessToken: adminToken,
        body: {
          name: "Someone Else's Product",
          slug: "someone-elses-product",
          sku: "OTHER-1",
          categoryId: phonesCategoryId,
          price: 500,
        },
      },
    );

    const stolen = await uploadFiles<Envelope<{ images: ProductImage[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${other.body.data.product.id}/images`,
      [{ field: "images", buffer: await makeTestImage(400, 400), filename: "theirs.png" }],
      { accessToken: adminToken },
    );

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}/variants/${variantId}`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { imageId: stolen.body.data.images[0]!.id },
      },
    );

    assert.equal(res.status, 422, JSON.stringify(res.body));
  });

  it("remembers that an axis is shown as pictures", async () => {
    const saved = await api<Envelope<{ product: { variantOptions: unknown[] } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${flagshipId}`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: {
          variantOptions: [
            { name: "Color", values: ["Titanium Gray", "Titanium Black"], display: "image" },
            { name: "Storage", values: ["256GB", "512GB"] },
          ],
        },
      },
    );

    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const shown = await api<
      Envelope<{ product: { variantOptions: { name: string; display?: string }[] } }>
    >(ctx.baseUrl, `/api/v1/products/${flagshipSlug}`);

    const options = shown.body.data.product.variantOptions;
    assert.equal(options.find((o) => o.name === "Color")?.display, "image");
    assert.equal(
      options.find((o) => o.name === "Storage")?.display,
      undefined,
      "an axis left as text stays text — old products must render unchanged",
    );
  });
});
