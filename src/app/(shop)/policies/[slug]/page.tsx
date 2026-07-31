import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPolicy, policies } from "@/data/policies";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";

export async function generateStaticParams() {
  return policies.map((p) => ({ slug: p.slug }));
}

/**
 * Fills `{shop}` with the shop's configured name.
 *
 * The policy copy is static, but the name in it is not — renaming the store in
 * the admin panel has to reach the terms and the About page, or a shopper sees
 * two different businesses and the trust those pages exist to build is gone.
 */
function withShopName(text: string, shopName: string): string {
  return text.replaceAll("{shop}", shopName);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) return { title: copy.common.notFoundTitle };

  const settings = await getSettings();
  const shopName = settings.storeName || copy.brand.name;

  return {
    title: withShopName(policy.title, shopName),
    description: withShopName(policy.summary, shopName),
    alternates: { canonical: `/policies/${policy.slug}` },
  };
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = getPolicy(slug);
  if (!policy) notFound();

  const settings = await getSettings();
  const shopName = settings.storeName || copy.brand.name;
  const fill = (text: string) => withShopName(text, shopName);

  return (
    <Container className="max-w-2xl py-8">
      <h1 className="text-display text-ink">{fill(policy.title)}</h1>
      <p className="mt-1 text-body text-muted">{fill(policy.summary)}</p>

      <div className="mt-8 flex flex-col gap-7">
        {policy.sections.map((section, i) => (
          <section key={section.heading ?? i}>
            {section.heading && (
              <h2 className="mb-2 text-title text-ink">{fill(section.heading)}</h2>
            )}

            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph}
                className="mb-3 text-body leading-relaxed text-ink-soft last:mb-0"
              >
                {fill(paragraph)}
              </p>
            ))}

            {section.bullets && (
              <ul className="mt-2 flex flex-col gap-2">
                {section.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-2.5 text-body text-ink-soft"
                  >
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-muted"
                      aria-hidden="true"
                    />
                    {fill(bullet)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Every policy page ends with a way to reach a human — these are the
          pages people land on when something has gone wrong. */}
      <div className="mt-10 flex flex-col gap-2 rounded-md border border-line p-4">
        <p className="text-caption font-semibold text-ink">{copy.contact.help}</p>
        <a
          href={`tel:${settings.hotline}`}
          className="inline-flex items-center gap-2 text-body font-medium text-ink"
        >
          <Icon name="phone" size={17} />
          {settings.hotline}
        </a>
        <a
          href={`https://wa.me/${settings.whatsappNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-body font-medium text-positive"
        >
          <Icon name="whatsapp" size={17} strokeWidth={1.5} />
          {copy.contact.whatsapp}
        </a>
      </div>
    </Container>
  );
}
