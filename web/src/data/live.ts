import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';

/** A live value from Firestore: undefined while loading, then the data, or the error that stopped it. */
export interface Live<T> {
  data: T | undefined;
  error: FirestoreError | null;
}

/**
 * Reads a document as a model: the model's defaults, then the stored fields, then the document id.
 * The Android app also stores an "id" field, which is ignored here in favor of the real document id.
 */
export function fromDoc<T extends object>(defaults: T, snap: DocumentSnapshot<DocumentData>, idField: keyof T | null = 'id' as keyof T): T {
  const data = { ...defaults, ...(snap.data() ?? {}) } as T;
  if (idField) (data as Record<string, unknown>)[idField as string] = snap.id;
  return data;
}

/** Keeps a query's documents live. key must change whenever the query does; a null query yields an empty list. */
export function useQueryList<T>(key: string, query: Query<DocumentData> | null, map: (snap: DocumentSnapshot<DocumentData>) => T): Live<T[]> {
  const [state, setState] = useState<Live<T[]> & { key: string }>({ key, data: undefined, error: null });
  useEffect(() => {
    if (!query) {
      setState({ key, data: [], error: null });
      return;
    }
    setState((s) => (s.key === key ? s : { key, data: undefined, error: null }));
    return onSnapshot(
      query,
      (snap) => setState({ key, data: snap.docs.map(map), error: null }),
      (error) => setState({ key, data: [], error }),
    );
    // The key stands for the query and the mapping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { data: undefined, error: null };
}

/** Keeps one document live: null while it does not exist. */
export function useDocValue<T>(key: string, ref: DocumentReference<DocumentData> | null, map: (snap: DocumentSnapshot<DocumentData>) => T): Live<T | null> {
  const [state, setState] = useState<Live<T | null> & { key: string }>({ key, data: undefined, error: null });
  useEffect(() => {
    if (!ref) {
      setState({ key, data: null, error: null });
      return;
    }
    setState((s) => (s.key === key ? s : { key, data: undefined, error: null }));
    return onSnapshot(
      ref,
      (snap) => setState({ key, data: snap.exists() ? map(snap) : null, error: null }),
      (error) => setState({ key, data: null, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { data: undefined, error: null };
}
