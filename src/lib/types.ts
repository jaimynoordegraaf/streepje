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
  /**
   * Taken off the menu, but kept so past turfs still have a price and still
   * count. Removing an item used to delete every turf for it.
   */
  hidden?: boolean;
};

/** A name kept between events, so the same crew is not retyped every time. */
export type SavedPerson = {
  id: string;
  name: string;
};

/** Someone attending an event. */
export type Person = {
  id: string;
  name: string;
  /**
   * How much has actually been handed over, in cents.
   *
   * An amount rather than a yes/no, because people pay round numbers against
   * odd totals -- ten euro against thirteen fifty. Whether someone is settled
   * is worked out from this and what they owe, not stored, so ordering another
   * drink after paying correctly reopens the difference.
   */
  paidCents: number;
  /** When money was last taken from them. Null if none has been. */
  paidAt: number | null;
  /**
   * When this person was removed from the event, if they were.
   *
   * Removing does not delete. Their turfs stay in the log, and the removal
   * itself is shown on the totals and in the export. Deleting outright would
   * have been a way to erase money without leaving a trace, which is exactly
   * what the correction PIN exists to prevent.
   */
  removedAt: number | null;
  /** Which phone removed them, by name, as it stood at the time. */
  removedBy: string | null;
  /**
   * For someone at an event: the id of the same person in the season tab.
   *
   * This is what lets a member's drinks at an event end up on the same
   * quarterly invoice as their drinks on a normal bar night. Matching by name
   * would turn "Jan" and "Jan de V." into two people -- exactly the mistake
   * that ends up on an invoice. Null for guests, and for everyone on a tab,
   * where the person is the member.
   */
  memberId: string | null;
  /** Whether this person is invoiced or settles on the night. */
  billing: Billing;
  /** Who a guest came with: the id of a person in the same list. */
  guestOf: string | null;
};

/**
 * What a list is for.
 *
 * An event is one occasion, where guests may settle on the night. A tab runs
 * across the season for the group's own members, who are invoiced by the
 * treasurer each quarter, so nothing on a tab is ever paid at the bar.
 */
export type ListKind = 'event' | 'tab';

/**
 * How someone's consumption gets paid.
 *
 * `invoice`: onto the treasurer's quarterly invoice -- every member, and any
 * guest who left their details. `tonight`: settled at the end of the evening,
 * by Tikkie or a payment request.
 */
export type Billing = 'invoice' | 'tonight';

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
  /**
   * What that phone called itself at the time, copied in rather than looked
   * up. A device renaming itself later must not change what the record says it
   * did earlier. Null for entries logged before naming existed, or on a phone
   * that has never shared.
   */
  deviceName: string | null;
  /**
   * The item's price at the moment of the tap, copied in for the same reason
   * as the device name: the menu can change later, and a turf already made
   * must keep costing what it cost. Without this a season tab would reprice
   * months of drinks the day beer goes up.
   *
   * On a correction this is recorded too, but not used: a correction takes off
   * an existing turf, and that turf keeps its own price. Null only for entries
   * from before prices were recorded, which count at the menu price.
   */
  priceCents: number | null;
  createdAt: number;
};

/**
 * A salted hash of the correction PIN. The PIN itself is never stored.
 * Lives in lib/pin.ts; declared here so the event type does not have to
 * import from a module that imports it back.
 */
export type PinRecord = {
  hash: string;
  salt: string;
};

/** A phone taking part in a shared event. */
export type SessionMember = {
  userId: string;
  /** What that phone called itself. Null if it joined before naming existed. */
  name: string | null;
  joinedAt: number;
};

/** Present when an event is shared across devices. */
export type ShareInfo = {
  /** Short code shown beneath the QR, so someone can join by typing instead. */
  joinCode: string;
  /**
   * Whether this phone is an admin of the shared list. The server's list of
   * admins is the truth; this is the last answer it gave, kept so the right
   * buttons still show while the phone is offline.
   */
  role: 'admin' | 'member';
  /** Last moment this device successfully reached the server. */
  lastSyncedAt: number | null;
};

export type AppEvent = {
  id: string;
  name: string;
  /** An event, or the season tab. Fixed when the list is created. */
  kind: ListKind;
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
  /**
   * Guards removing a turf. Null until the host sets one, at which point the
   * app asks for it on the first attempted correction.
   *
   * Deliberately NOT synced to the server: it is only ever checked on the
   * phone that owns the event, so there is no reason for other devices -- or
   * the database -- to hold a copy.
   */
  correctionPin: PinRecord | null;
};
