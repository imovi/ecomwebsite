import type { Category } from "@/types";

export const categories: Category[] = [
  { id: "cat-phones", name: "Smartphones", slug: "smartphones", icon: "mobile", sortOrder: 1 },
  { id: "cat-audio", name: "Audio", slug: "audio", icon: "headphones", sortOrder: 2 },
  { id: "cat-watches", name: "Smartwatches", slug: "smartwatches", icon: "watch", sortOrder: 3 },
  { id: "cat-laptops", name: "Laptops", slug: "laptops", icon: "laptop", sortOrder: 4 },
  { id: "cat-speakers", name: "Speakers", slug: "speakers", icon: "speaker", sortOrder: 5 },
  { id: "cat-cameras", name: "Cameras", slug: "cameras", icon: "camera", sortOrder: 6 },
  { id: "cat-power", name: "Power", slug: "power", icon: "power", sortOrder: 7 },
  { id: "cat-gaming", name: "Gaming", slug: "gaming", icon: "gamepad", sortOrder: 8 },
];
