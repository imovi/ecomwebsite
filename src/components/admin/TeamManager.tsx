"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatDate } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Team management.
 *
 * Roles are named for what they let someone DO, not for their rank. "Manager"
 * and "Admin" mean nothing to a shop owner deciding who to trust with what, so
 * each option carries its own one-line description.
 */

type Role = "manager" | "admin" | "super_admin";

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lockedUntil: string | null;
  /** Server-computed: whether the failed-login lock is still in force. */
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: "manager",
    label: "Staff",
    description: "Works the order queue and the catalogue. Cannot change prices, settings or people.",
  },
  {
    value: "admin",
    label: "Manager",
    description: "Everything above, plus delivery charges, branding and tracking.",
  },
  {
    value: "super_admin",
    label: "Owner",
    description: "Full control, including adding and removing people.",
  },
];

const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

export function TeamManager() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  /**
   * Shown once, after creating an account or resetting a password.
   *
   * There is no invitation email in this system, so this is the only moment the
   * password exists anywhere readable — it has to be impossible to miss.
   */
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ team: TeamMember[] }>("admin/team");
      setTeam(data.team);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can manage the team."
            : caught.message
          : "Could not load the team.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const run = useCallback(
    async (action: () => Promise<unknown>, message: string): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        toast(message);
        await load();
        return true;
      } catch (caught) {
        setActionError(
          caught instanceof AdminApiError ? caught.message : "Could not save.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <AdminShell
      title="Team"
      action={
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Add person
        </Button>
      }
    >
      <PageBody>
        <ErrorBanner message={actionError} className="2xl:col-span-2" />

        {credential && (
          <Card className="border-positive/30 bg-positive-soft 2xl:col-span-2">
            <div className="flex flex-col gap-2 p-4">
              <p className="flex items-center gap-2 text-caption font-semibold text-positive">
                <Icon name="check" size={16} />
                Password for {credential.email}
              </p>
              <p className="tnum select-all rounded-sm bg-white px-3 py-2 font-mono text-body text-ink">
                {credential.password}
              </p>
              <p className="text-caption text-positive">
                Copy it and send it to them now — it is not stored anywhere and will not be
                shown again.
              </p>
              <Button
                variant="soft"
                size="sm"
                className="self-start"
                onClick={() => setCredential(null)}
              >
                Done
              </Button>
            </div>
          </Card>
        )}

        {adding && (
          <AddMemberForm
            className="2xl:col-span-2"
            busy={busy}
            onCancel={() => setAdding(false)}
            onCreate={async (payload) => {
              setBusy(true);
              setActionError(null);
              try {
                const created = await adminApi.post<{
                  admin: TeamMember;
                  password: string;
                }>("admin/team", payload);
                setCredential({ email: created.admin.email, password: created.password });
                toast("Account created");
                await load();
                setAdding(false);
              } catch (caught) {
                setActionError(
                  caught instanceof AdminApiError ? caught.message : "Could not create.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          <ul className="flex flex-col gap-2 2xl:col-span-2">
            {team.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                busy={busy}
                onChangeRole={(role) =>
                  run(
                    () => adminApi.patch(`admin/team/${member.id}`, { role }),
                    "Role updated",
                  )
                }
                onToggleActive={() =>
                  run(
                    () =>
                      adminApi.patch(`admin/team/${member.id}`, {
                        isActive: !member.isActive,
                      }),
                    member.isActive ? "Access removed" : "Access restored",
                  )
                }
                onResetPassword={async () => {
                  setBusy(true);
                  setActionError(null);
                  try {
                    const result = await adminApi.post<{
                      admin: TeamMember;
                      password: string;
                    }>(`admin/team/${member.id}/password`, {});
                    setCredential({ email: member.email, password: result.password });
                    toast("Password reset");
                    await load();
                  } catch (caught) {
                    setActionError(
                      caught instanceof AdminApiError ? caught.message : "Could not reset.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                onDelete={() => {
                  if (
                    !window.confirm(
                      `Delete ${member.email}? They lose access immediately. ` +
                        "Removing access instead keeps the account and its history.",
                    )
                  ) {
                    return;
                  }
                  void run(
                    () => adminApi.delete(`admin/team/${member.id}`),
                    "Account deleted",
                  );
                }}
              />
            ))}
          </ul>
        </AsyncState>

        <Card>
          <CardHeader title="What each role can do" />
          <ul className="flex flex-col divide-y divide-line">
            {ROLES.map((role) => (
              <li key={role.value} className="px-4 py-3">
                <p className="text-caption font-semibold text-ink">{role.label}</p>
                <p className="mt-0.5 text-micro text-muted">{role.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

function MemberRow({
  member,
  busy,
  onChangeRole,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  member: TeamMember;
  busy: boolean;
  onChangeRole: (role: Role) => Promise<boolean>;
  onToggleActive: () => Promise<boolean>;
  onResetPassword: () => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-white p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-caption font-medium text-ink">
          {member.name}
          {!member.isActive && <Badge tone="saleSoft">No access</Badge>}
          {member.isLocked && <Badge tone="warn">Locked</Badge>}
        </p>
        <p className="truncate text-micro text-muted">
          {member.email}
          {member.lastLoginAt
            ? ` · last signed in ${formatDate(member.lastLoginAt)}`
            : " · never signed in"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          label=""
          aria-label={`Role for ${member.name}`}
          value={member.role}
          disabled={busy}
          onChange={(event) => void onChangeRole(event.target.value as Role)}
          className="h-9 text-caption"
          wrapperClassName="w-[130px]"
        >
          {ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </Select>

        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onResetPassword()}>
          Reset password
        </Button>

        <Button variant="soft" size="sm" disabled={busy} onClick={() => void onToggleActive()}>
          {member.isActive ? "Remove access" : "Restore"}
        </Button>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${member.email}`}
          className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-30"
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </li>
  );
}

function AddMemberForm({
  busy,
  className,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  className?: string;
  onCancel: () => void;
  onCreate: (payload: { email: string; name: string; role: Role }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("manager");

  const selected = ROLES.find((r) => r.value === role);

  return (
    <Card className={className}>
      <CardHeader
        title="Add someone to the team"
        hint="They get a generated password, shown once after you save. There is no invitation email — pass it to them yourself."
      />
      <div className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          hint={selected?.description}
        >
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={name.trim() === "" || email.trim() === ""}
            onClick={() =>
              void onCreate({ email: email.trim(), name: name.trim(), role })
            }
          >
            Create account
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

export { roleLabel };
