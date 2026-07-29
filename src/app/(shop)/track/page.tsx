import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { TrackOrderForm } from "@/components/shop/TrackOrderForm";

export const metadata: Metadata = {
  title: copy.track.title,
  description: copy.track.intro,
  alternates: { canonical: "/track" },
};

export default function TrackPage() {
  return (
    <Container className="py-8">
      <div className="mx-auto mb-6 max-w-md text-center">
        <h1 className="text-display text-ink">{copy.track.title}</h1>
        <p className="mt-1.5 text-body text-muted">{copy.track.intro}</p>
      </div>
      <TrackOrderForm />
    </Container>
  );
}
