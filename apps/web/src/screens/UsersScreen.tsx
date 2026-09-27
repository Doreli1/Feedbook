import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { StaffDirectoryRow } from '@feedbook/types';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

const ROLE_VALUES = ['manager', 'waiter', 'kitchen'] as const;
type Role = (typeof ROLE_VALUES)[number];

const ROLE_PERMISSIONS: Record<Role, TranslationKey[]> = {
  manager: ['roleManagerPerm1', 'roleManagerPerm2', 'roleManagerPerm3', 'roleManagerPerm4'],
  waiter: ['roleWaiterPerm1', 'roleWaiterPerm2'],
  kitchen: ['roleKitchenPerm1', 'roleKitchenPerm2'],
};

interface Props {
  session: Session;
  restaurantId: string;
  staff: StaffDirectoryRow[];
  onRefresh: () => void;
}

export function UsersScreen({ session, restaurantId, staff, onRefresh }: Props) {
  const { t } = useI18n();
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const roleLabel: Record<Role, string> = {
    manager: t('roleManager'),
    waiter: t('roleWaiter'),
    kitchen: t('roleKitchen'),
  };

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('usersTitle')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('usersSubtitle')}</p>

      {staff.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnFirstName')}</th>
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnLastName')}</th>
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnRole')}</th>
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnEmail')}</th>
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnPhone')}</th>
                <th className="px-3 py-2 text-start text-eyebrow">{t('staffColumnStatus')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) =>
                editingId === member.id ? (
                  <tr key={member.id}>
                    <td colSpan={7} className="p-0">
                      <StaffEditForm
                        member={member}
                        roleLabel={roleLabel}
                        onDone={() => {
                          setEditingId(null);
                          onRefresh();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={member.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2.5 font-medium text-ink">{member.first_name || '—'}</td>
                    <td className="px-3 py-2.5 text-ink">{member.last_name || '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{roleLabel[member.role as Role]}</td>
                    <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">
                      {member.email}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground" dir="ltr">
                      {member.phone || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          member.is_active ? 'bg-success-soft text-success' : 'bg-surface text-ink-muted'
                        }`}
                      >
                        {member.is_active ? t('staffActive') : t('staffInactive')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end">
                      <button
                        type="button"
                        onClick={() => setEditingId(member.id)}
                        className="rounded border border-border px-2.5 py-1 text-xs text-ink hover:bg-surface"
                      >
                        {t('editStaffMember')}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {staff.length === 0 && <p className="mb-3 text-sm text-muted-foreground">{t('usersEmpty')}</p>}

      {addingNew ? (
        <InviteStaffForm
          session={session}
          restaurantId={restaurantId}
          onDone={() => {
            setAddingNew(false);
            onRefresh();
          }}
          onCancel={() => setAddingNew(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className="w-full rounded border border-dashed border-border-strong py-2 text-sm text-accent hover:bg-accent-soft"
        >
          {t('addStaffMember')}
        </button>
      )}
    </div>
  );
}

function StaffEditForm({
  member,
  roleLabel,
  onDone,
  onCancel,
}: {
  member: StaffDirectoryRow;
  roleLabel: Record<Role, string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(member.first_name ?? '');
  const [lastName, setLastName] = useState(member.last_name ?? '');
  const [phone, setPhone] = useState(member.phone ?? '');
  const [role, setRole] = useState<Role>(member.role as Role);
  const [isActive, setIsActive] = useState(member.is_active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('staff')
      .update({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        role,
        is_active: isActive,
      })
      .eq('id', member.id);
    setSaving(false);
    if (updateError) {
      // The last-active-manager guard trigger raises a plain Postgres
      // exception — its message is exactly what should reach the manager
      // here, not a pre-guessed client-side copy of the same rule.
      setError(updateError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="border-t border-b border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t('staffColumnFirstName')}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t('staffColumnLastName')}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="flex-1 rounded border border-border px-2 py-1.5 text-sm">
          {ROLE_VALUES.map((r) => (
            <option key={r} value={r}>
              {roleLabel[r]}
            </option>
          ))}
        </select>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('staffColumnPhone')}
          dir="ltr"
          className="flex-1 rounded border border-border px-2 py-1.5 text-sm"
        />
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t('staffActive')}
        </label>
      </div>
      <div className="mb-3 rounded border border-border bg-surface-2 p-2">
        <p className="mb-1 text-[11px] font-medium text-ink-soft">{t('rolePermissionsPreview')}</p>
        <ul className="space-y-0.5">
          {ROLE_PERMISSIONS[role].map((key) => (
            <li key={key} className="text-[11px] text-muted-foreground">
              · {t(key)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? t('saving') : t('saveStaffMember')}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2">
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}

function InviteStaffForm({
  session,
  restaurantId,
  onDone,
  onCancel,
}: {
  session: Session;
  restaurantId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('waiter');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel: Record<Role, string> = {
    manager: t('roleManager'),
    waiter: t('roleWaiter'),
    kitchen: t('roleKitchen'),
  };

  const canSave = firstName.trim() !== '' && lastName.trim() !== '' && email.includes('@') && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-staff`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        restaurant_id: restaurantId,
        email: email.trim(),
        role,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setError(
        body?.error?.code === 'EMAIL_ALREADY_REGISTERED' ? t('inviteEmailAlreadyRegistered') : (body?.error?.message ?? t('genericError')),
      );
      return;
    }
    onDone();
  }

  return (
    <div className="rounded border border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t('staffColumnFirstName')}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t('staffColumnLastName')}
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('staffEmailPlaceholder')}
          dir="ltr"
          className="col-span-1 rounded border border-border px-2 py-1.5 text-sm"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('staffColumnPhone')}
          dir="ltr"
          className="rounded border border-border px-2 py-1.5 text-sm"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded border border-border px-2 py-1.5 text-sm">
          {ROLE_VALUES.map((r) => (
            <option key={r} value={r}>
              {roleLabel[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('sendingInvite') : t('sendInvite')}
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2">
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
