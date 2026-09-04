"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

const TABS = [
  {
    href: "/admin/customization/announcement",
    label: "Announcement Bar",
    icon: "speaker",
    description: "Header notice banner & promotions",
  },
  {
    href: "/admin/customization/whatsapp",
    label: "WhatsApp Templates",
    icon: "whatsapp",
    description: "Automated order & recovery messages",
  },
  {
    href: "/admin/customization/checkout",
    label: "Checkout Form",
    icon: "cart",
    description: "Form fields, language & layout",
  },
];

export function CustomizationTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 border-b border-line">
      <div className="flex overflow-x-auto no-scrollbar gap-2 sm:gap-4">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "group flex items-center gap-2 px-3 sm:px-4 py-3 text-caption font-medium border-b-2 transition-all whitespace-nowrap -mb-px",
                isActive
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted hover:text-ink hover:border-line"
              )}
            >
              <Icon
                name={tab.icon}
                size={16}
                className={cn(
                  "transition-colors",
                  isActive ? "text-primary" : "text-muted group-hover:text-ink"
                )}
              />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
