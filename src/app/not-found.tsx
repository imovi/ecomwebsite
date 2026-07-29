import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Layout";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <EmptyState
        icon="search"
        title={copy.common.notFoundTitle}
        body={copy.common.notFoundBody}
      >
        <Button href="/" variant="primary" size="lg">
          {copy.common.goHome}
        </Button>
      </EmptyState>
    </main>
  );
}
