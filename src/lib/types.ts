/**
 * The shape of everything the app stores.
 *
 * Note on money: every price is kept as a whole number of CENTS (an integer).
 * 2.50 euro is stored as 250. This is deliberate -- computers cannot represent
 * 0.1 exactly, so adding decimals repeatedly slowly drifts off (0.1 + 0.2 gives
 * 0.30000000000000004). With integers the totals are always exact.
 */

export type Category = 'drink' | 'food';

/** One thing that can be ordered, e.g. "Beer" at 250 cents. */
export type MenuItem = {
  id: string;
  name: string;
  priceCents: number;
  category: Category;
};

/** Someone attending an event. */
export type Person = {
  id: string;
  name: string;
  paid: boolean;
  /** When they paid, as a timestamp in milliseconds. Null while unpaid. */
  paidAt: number | null;
};

/**
 * One logged order. These are only ever ADDED, never changed or removed.
 *
 * That is the whole trick behind multi-device support. If two phones stored a
 * running count instead, both could read "3 beers", both write "4", and one
 * order would vanish without trace. Because every tap is its own row with its
 * own id, two phones can log at the same instant and neither can overwrite the
 * other -- the totals are simply the sum of every row.
 *
 * A correction is a row too: tapping minus adds an entry with delta -1.
 */
export type OrderEntry = {
  id: string;
  personId: string;
  itemId: string;
  /** Usually +1 or -1, but any whole number is valid. */
  delta: number;
  /** Which phone logged this, so an order can be traced back. */
  deviceId: string;
  createdAt: number;
};

/** Present when an event is shared across devices. */
export type ShareInfo = {
  /** Short code shown beneath the QR, so someone can join by typing instead. */
  joinCode: string;
  /** The host created the event; guests joined it. */
  role: 'host' | 'guest';
  /** Last moment this device successfully reached the server. */
  lastSyncedAt: number | null;
};

export type AppEvent = {
  id: string;
  name: string;
  createdAt: number;
  people: Person[];
  /**
   * The menu is copied into the event when the event is created, rather than
   * shared with every event. That way, changing the price of beer next month
   * does not silently rewrite what people owed at last month's party.
   */
  menu: MenuItem[];
  /** Every order ever logged for this event, oldest first. */
  entries: OrderEntry[];
  /**
   * Ids of entries this device has not yet managed to send to the server.
   * Filled while offline and drained once the connection comes back.
   */
  unsyncedEntryIds: string[];
  /** Closed events are done and settled; kept for the record. */
  closed: boolean;
  /** Null while the event lives only on this phone. */
  share: ShareInfo | null;
};
