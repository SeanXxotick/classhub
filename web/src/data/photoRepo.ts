import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, documentId, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';

/*
 * Profile pictures (avatars/{uid}) and class pictures (classPhotos/{classId}). Each is a small square
 * JPEG stored as Base64 text in one document, so no file storage service is needed.
 */

const avatars = collection(db, 'avatars');
const classPhotos = collection(db, 'classPhotos');

/** A data: URL the browser can show, from the Base64 JPEG text the apps store. */
export const photoSrc = (photo: string) => `data:image/jpeg;base64,${photo}`;

export function useAvatar(uid: string | null): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    setPhoto(null);
    if (!uid) return;
    return onSnapshot(
      doc(avatars, uid),
      (s) => setPhoto((s.get('photo') as string | undefined) ?? null),
      () => setPhoto(null),
    );
  }, [uid]);
  return photo;
}

/** Photos of many users at once, as uid to photo. Firestore allows up to 30 ids per "in" query, so ids are split into chunks. */
export function useAvatars(uids: string[]): Map<string, string> {
  const key = [...new Set(uids.filter(Boolean))].sort().join(',');
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const parts = new Map<number, Map<string, string>>();
    const publish = () => setPhotos(new Map([...parts.values()].flatMap((m) => [...m])));
    setPhotos(new Map());
    const stops: (() => void)[] = [];
    for (let i = 0; i < ids.length; i += 30) {
      const index = i;
      stops.push(
        onSnapshot(
          query(avatars, where(documentId(), 'in', ids.slice(i, i + 30))),
          (snap) => {
            parts.set(index, new Map(snap.docs.flatMap((d) => (typeof d.get('photo') === 'string' ? [[d.id, d.get('photo') as string]] : []))));
            publish();
          },
          () => {
            parts.delete(index);
            publish();
          },
        ),
      );
    }
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return photos;
}

/** Class pictures for the given classes. Each is read on its own, since only members may read it. */
export function useClassPhotos(classIds: string[]): Map<string, string> {
  const key = [...new Set(classIds.filter(Boolean))].sort().join(',');
  const [photos, setPhotos] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const found = new Map<string, string>();
    setPhotos(new Map());
    const stops = ids.map((id) =>
      onSnapshot(
        doc(classPhotos, id),
        (s) => {
          const photo = s.get('photo');
          if (typeof photo === 'string') found.set(id, photo);
          else found.delete(id);
          setPhotos(new Map(found));
        },
        () => {
          found.delete(id);
          setPhotos(new Map(found));
        },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return photos;
}

/** The accent colour of each class the user is in, so class icons outside the class match it. */
export function useClassAccents(classIds: string[]): Map<string, string> {
  const key = [...new Set(classIds.filter(Boolean))].sort().join(',');
  const [accents, setAccents] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const found = new Map<string, string>();
    const stops = ids.map((id) =>
      onSnapshot(
        doc(db, 'classes', id),
        (s) => {
          const color = s.get('accentColor');
          if (typeof color === 'string') found.set(id, color);
          else found.delete(id);
          setAccents(new Map(found));
        },
        () => undefined,
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return accents;
}

export function setAvatar(uid: string, photo: string): Promise<void> {
  return setDoc(doc(avatars, uid), { photo, updatedAtMillis: Date.now() });
}

export function removeAvatar(uid: string): Promise<void> {
  return deleteDoc(doc(avatars, uid));
}

export function setClassPhoto(classId: string, photo: string): Promise<void> {
  return setDoc(doc(classPhotos, classId), { photo, updatedAtMillis: Date.now() });
}

export function removeClassPhoto(classId: string): Promise<void> {
  return deleteDoc(doc(classPhotos, classId));
}
