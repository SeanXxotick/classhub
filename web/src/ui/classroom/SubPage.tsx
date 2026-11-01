import type { ReactNode } from 'react';
import { Loading, TopBar, useBack } from '../common';
import { useClass } from './ClassContext';

/** A screen inside a class with "‹ Back" (the Android ManageScaffold). */
export function SubPage({ title, actions, wide, children }: { title: string; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  const { state } = useClass();
  const back = useBack(`/class/${state.classId}`);
  return (
    <>
      <TopBar title={title} back={back} actions={actions} />
      {state.loading ? <Loading /> : <div className={'page' + (wide ? '' : ' narrow')}>{children}</div>}
    </>
  );
}

/** "Your role does not allow you to ..." */
export function NoAccess({ what }: { what: string }) {
  return <p className="empty">Your role does not allow you to {what}.</p>;
}
