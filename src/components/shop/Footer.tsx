import Link from "next/link";
import { getCategories } from "@/lib/data/catalog";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";

const HELP_LINKS = [
  { href: "/track", label: copy.nav.trackOrder },
  { href: "/policies/delivery", label: "Delivery" },
  { href: "/policies/returns", label: "Returns & refunds" },
  { href: "/policies/warranty", label: "Warranty" },
];

/** `{shop}` is filled from store settings — see the policy pages. */
const ABOUT_LINKS = [
  { href: "/policies/about", label: "About {shop}" },
  { href: "/policies/contact", label: "Contact" },
  { href: "/policies/terms", label: "Terms" },
  { href: "/policies/privacy", label: "Privacy" },
];

export async function Footer() {
  const [categories, settings] = await Promise.all([getCategories(), getSettings()]);
  const shopName = settings.storeName || copy.brand.name;

  return (
    /* Bottom padding clears the sticky buy bar on product pages. */
    <footer className="mt-16 border-t border-line bg-surface pb-24 pt-10 md:pb-10">
      <Container>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            {/* The shop's own name, so a store that renamed itself in Settings is
                not still called "gng" down here while the header shows its logo. */}
            <p className="text-title tracking-[-0.04em] text-ink">{shopName}</p>
            <p className="mt-1 text-caption text-muted">{copy.brand.tagline}</p>

            <a
              href={`tel:${settings.hotline}`}
              className="mt-4 inline-flex items-center gap-2 text-caption font-medium text-ink"
            >
              <Icon name="phone" size={16} />
              {settings.hotline}
            </a>
          </div>

          <FooterColumn title={copy.home.categoriesTitle}>
            {categories.slice(0, 6).map((c) => (
              <FooterLink key={c.id} href={`/category/${c.slug}`}>
                {c.name}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title={copy.footer.help}>
            {HELP_LINKS.map((l) => (
              <FooterLink key={l.href} href={l.href}>
                {l.label}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title={copy.footer.about}>
            {ABOUT_LINKS.map((l) => (
              <FooterLink key={l.href} href={l.href}>
                {l.label.replaceAll("{shop}", shopName)}
              </FooterLink>
            ))}
          </FooterColumn>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-center text-caption text-muted">
          {copy.footer.rights(new Date().getFullYear(), shopName)}
        </p>
      </Container>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <nav aria-label={title}>
      <h2 className="text-caption font-semibold text-ink">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2">{children}</ul>
    </nav>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-caption text-muted transition-colors hover:text-ink"
      >
        {children}
      </Link>
    </li>
  );
}
