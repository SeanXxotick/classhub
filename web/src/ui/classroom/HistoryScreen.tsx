import { useState } from 'react';
import { db } from '../../data/firebase';
import { friendlyMessage } from '../../data/errors';
import { useHistory, type HistoryEntry, type HistoryKind } from '../../data/history';
import { Button, Card, DayHeader, FilterChips, ListRow, Notice, TypeIcon, type IconName, type Tone } from '../../design';
import { Spinner } from '../common';
import { useClass } from './ClassContext';
import { NoAccess, SubPage } from './SubPage';

const PAGE = 50;

type Filter = 'ALL' | 'MONEY' | 'PEOPLE';
const MONEY: HistoryKind[] = ['PAYMENT', 'WITHDRAWAL', 'OPENING', 'OPENING_PENDING', 'CHARGE', 'PAYOUT', 'VOID', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'LEDGER_SETTINGS', 'REMINDERS'];

const LOOK: Record<HistoryKind, [IconName, Tone]> = {
  PAYMENT: ['income', 'income'],
  WITHDRAWAL: ['withdrawal', 'withdrawal'],
  OPENING: ['coins', 'opening'],
  OPENING_PENDING: ['hourglass', 'opening'],
  CHARGE: ['charge', 'charge'],
  PAYOUT: ['payout', 'payout'],
  VOID: ['ban', 'danger'],
  CLAIM_CONFIRMED: ['check', 'success'],
  CLAIM_REJECTED: ['x', 'danger'],
  LEDGER_SETTINGS: ['ledger', 'neutral'],
  JOIN_APPROVED: ['userplus', 'success'],
  JOIN_REJECTED: ['x', 'danger'],
  MEMBER_REMOVED: ['logout', 'danger'],
  MEMBER_ROLE: ['shield', 'primary'],
  MEMBER_COURSES: ['book', 'neutral'],
  ROLE_SAVED: ['shield', 'primary'],
  ROLE_DELETED: ['trash', 'danger'],
  MAYOR_HANDOVER: ['key', 'warning'],
  INVITE_CODE: ['key', 'neutral'],
  CLASS_SETTINGS: ['sliders', 'neutral'],
  CLASS_PHOTO: ['camera', 'neutral'],
  REMINDERS: ['bell', 'warning'],
};

const dayLabel = (millis: number) => new Date(millis).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (millis: number) => new Date(millis).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * The history log of officer actions on money and people, newest first (CLASS_SETTINGS). Entries cannot be
 * edited or deleted by anyone; they go only when the class is deleted.
 */
export function HistoryScreen() {
  const { state } = useClass();
  const allowed = state.can('CLASS_SETTINGS');
  const [count, setCount] = useState(PAGE);
  const [filter, setFilter] = useState<Filter>('ALL');
  const { data, error } = useHistory(db, state.classId, count, allowed);
  const nameOf = (e: HistoryEntry) => state.members.find((m) => m.id === e.actorUid)?.name ?? (e.actorName ? `${e.actorName} (left the class)` : 'A former officer');
  const shown = (data ?? []).filter((e) => filter === 'ALL' || (filter === 'MONEY') === MONEY.includes(e.kind));

  // Group by day, keeping the newest-first order.
  const days: { label: string; entries: HistoryEntry[] }[] = [];
  for (const e of shown) {
    const label = dayLabel(e.atMillis);
    if (days.at(-1)?.label === label) days.at(-1)!.entries.push(e);
    else days.push({ label, entries: [e] });
  }

  return (
    <SubPage title="History log">
      {!allowed ? (
        <NoAccess what="see the history log" />
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Every change officers make to the ledger, members, roles and class settings. Nobody can edit or delete these entries.
          </p>
          <FilterChips
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'ALL', label: 'All' }, { value: 'MONEY', label: 'Money' }, { value: 'PEOPLE', label: 'People and settings' }]}
          />
          {error && <Notice tone="danger">{friendlyMessage(error)}</Notice>}
          {!data && !error && <Spinner />}
          {data && shown.length === 0 && (
            <p className="empty">{data.length === 0 ? 'Nothing yet. Officer actions show here from now on.' : 'Nothing of this kind in the entries loaded.'}</p>
          )}
          {days.map((day) => (
            <Card flush key={day.label}>
              <DayHeader>{day.label}</DayHeader>
              {day.entries.map((e) => {
                const [icon, tone] = LOOK[e.kind];
                return (
                  <ListRow
                    key={e.id}
                    leading={<TypeIcon icon={icon} tone={tone} />}
                    title={e.text}
                    subtitle={`${nameOf(e)} · ${timeLabel(e.atMillis)}`}
                  />
                );
              })}
            </Card>
          ))}
          {data && data.length === count && (
            <Button variant="text" icon="down" onClick={() => setCount(count + PAGE)}>
              Show older
            </Button>
          )}
        </div>
      )}
    </SubPage>
  );
}
