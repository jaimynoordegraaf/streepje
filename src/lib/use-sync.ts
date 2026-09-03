/**
 * Keeps one event in step with its shared copy while a screen is open.
 *
 * Nothing here blocks the interface. If the network is down the app carries on
 * exactly as before -- taps are logged locally and queued -- and the queue is
 * drained the moment the connection returns. That matters because the place
 * you will actually use this, a busy bar or a campsite, is where signal is
 * worst.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useStore } from './store';
import { isSyncConfigured } from './supabase';
import { fetchSession, pushDetails, pushEntries, subscribeToSession } from './sync';
import type { AppEvent } from './types';

export type SyncStatus = 'off' | 'connecting' | 'live' | 'offline';

export function useEventSync(event: AppEvent | undefined) {
  const mergeRemoteEntries = useStore((state) => state.mergeRemoteEntries);
  const mergeRemoteDetails = useStore((state) => state.mergeRemoteDetails);
  const markEntriesSynced = useStore((state) => state.markEntriesSynced);
  const noteSynced = useStore((state) => state.noteSynced);

  const [status, setStatus] = useState<SyncStatus>('off');
  const [attempt, setAttempt] = useState(0);

  const eventId = event?.id;
  const shared = Boolean(event?.share) && isSyncConfigured;
  const pending = event?.unsyncedEntryIds.length ?? 0;

  /** Changing any of this means the shared copy needs updating. */
  const detailsSignature = useMemo(
    () =>
      event
        ? JSON.stringify({
            name: event.name,
            closed: event.closed,
            people: event.people,
            menu: event.menu,
          })
        : '',
    [event]
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // Catch up on what we missed, then listen for what comes next.
  useEffect(() => {
    if (!shared || !eventId) {
      setStatus('off');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const start = async () => {
      setStatus('connecting');
      try {
        const remote = await fetchSession(eventId);
        if (cancelled) return;

        mergeRemoteDetails(eventId, remote);
        mergeRemoteEntries(eventId, remote.entries);
        noteSynced(eventId);

        unsubscribe = subscribeToSession(eventId, {
          onEntry: (entry) => mergeRemoteEntries(eventId, [entry]),
          onDetailsChanged: () => {
            fetchSession(eventId)
              .then((fresh) => {
                if (cancelled) return;
                mergeRemoteDetails(eventId, fresh);
                mergeRemoteEntries(eventId, fresh.entries);
              })
              .catch(() => setStatus('offline'));
          },
        });

        if (!cancelled) setStatus('live');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    };

    start();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [shared, eventId, attempt, mergeRemoteDetails, mergeRemoteEntries, noteSynced]);

  // Drain the queue of orders logged on this device.
  useEffect(() => {
    if (status !== 'live' || !event || pending === 0) return;

    const queued = new Set(event.unsyncedEntryIds);
    const rows = event.entries.filter((entry) => queued.has(entry.id));
    if (rows.length === 0) return;

    let cancelled = false;
    pushEntries(event.id, rows)
      .then(() => {
        if (cancelled) return;
        markEntriesSynced(event.id, rows.map((row) => row.id));
        noteSynced(event.id);
      })
      .catch(() => {
        // Left in the queue; the next status change or retry picks it up again.
        if (!cancelled) setStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, [status, pending, event, markEntriesSynced, noteSynced]);

  // Send edits to people, the menu and the event name.
  useEffect(() => {
    if (status !== 'live' || !event) return;
    pushDetails(event).catch(() => setStatus('offline'));
    // Deliberately keyed on the signature rather than the event object, so this
    // fires when the content changes and not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, detailsSignature]);

  // While offline, try again every 15 seconds.
  useEffect(() => {
    if (status !== 'offline') return;
    const timer = setInterval(retry, 15000);
    return () => clearInterval(timer);
  }, [status, retry]);

  return { status, pending, retry };
}
