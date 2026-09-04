import { AdminShell } from "@/components/admin/AdminShell";
import { PageBody } from "@/components/admin/ui";
import { CustomizationTabs } from "@/components/admin/CustomizationTabs";
import { WhatsAppTemplates } from "@/components/admin/WhatsAppTemplates";

export default function WhatsAppTemplatesPage() {
  return (
    <AdminShell title="Customization">
      <PageBody columns={false}>
        <CustomizationTabs />
        <WhatsAppTemplates />
      </PageBody>
    </AdminShell>
  );
}
