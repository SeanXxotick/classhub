import type { ClassRoom } from '../../data/models';

export type ClassTabId = 'HOME' | 'LEDGER' | 'SCHEDULE' | 'CONTENTS' | 'MEMBERS';

/** The class tabs in order, with the Android line icons. */
export const CLASS_TABS: { id: ClassTabId; label: string; icon: string }[] = [
  { id: 'HOME', label: 'Home', icon: 'ic_tab_home' },
  { id: 'LEDGER', label: 'Ledger', icon: 'ic_tab_ledger' },
  { id: 'SCHEDULE', label: 'Schedule', icon: 'ic_tab_schedule' },
  { id: 'CONTENTS', label: 'Contents', icon: 'ic_tab_contents' },
  { id: 'MEMBERS', label: 'Members', icon: 'ic_tab_members' },
];

/** Ledger, Schedule and Contents can each be turned off in Class settings. */
export function tabShownIn(tab: ClassTabId, room: ClassRoom | null): boolean {
  switch (tab) {
    case 'LEDGER':
      return room?.ledgerEnabled !== false;
    case 'SCHEDULE':
      return room?.scheduleEnabled !== false;
    case 'CONTENTS':
      return room?.contentsEnabled !== false;
    default:
      return true;
  }
}
