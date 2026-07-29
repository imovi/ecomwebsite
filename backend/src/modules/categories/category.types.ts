import { getStorage } from "../../lib/storage/index.js";
import type { CategoryRow } from "../../db/schema/categories.js";

/**
 * Public shape of a category.
 *
 * `imageKey` is deliberately not exposed — clients get a resolved `imageUrl`.
 * Leaking storage keys couples the API contract to the storage layout and
 * invites clients to construct their own URLs, which then break the day the
 * bucket moves.
 */
export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Present only where the query computed it. */
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export function toCategoryDto(
  row: CategoryRow,
  extra: { productCount?: number } = {},
): CategoryDto {
  const dto: CategoryDto = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageKey ? getStorage().url(row.imageKey) : null,
    icon: row.icon,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (extra.productCount !== undefined) dto.productCount = extra.productCount;
  return dto;
}
