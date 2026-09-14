/**
 * Android has no built-in "ask for one line of text" dialog (iOS does, via
 * Alert.prompt), so these two small modals fill that gap.
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/text';

import { centsToInput, parsePrice } from '@/lib/money';
import type { AppEvent, Billing, Category, ListKind, MenuItem, Person } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

import { CheckIcon } from './icons';
import { Button, Field } from './ui';

function Backdrop({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: space.lg,
        }}>
        {/* Pressing the card itself must not close the modal. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.card,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md,
          }}>
          {children}
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

export function PromptModal({
  visible,
  title,
  placeholder,
  initialValue = '',
  submitLabel = 'Opslaan',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initialValue);

  // Reset the field every time the modal is opened.
  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const submit = () => {
    if (text.trim() === '') return;
    onSubmit(text.trim());
  };

  // A closed modal is unmounted rather than left in place: otherwise its dark
  // backdrop stays in the tree and dims the screen behind it.
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        <Field
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          autoFocus
          onSubmitEditing={submit}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title={submitLabel}
            onPress={submit}
            disabled={text.trim() === ''}
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}

/** Add or edit a menu item: name, price and whether it is a drink or food. */
export function ItemFormModal({
  visible,
  item,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  /** Pass an existing item to edit it, or null to add a new one. */
  item: MenuItem | null;
  onCancel: () => void;
  onSubmit: (draft: Omit<MenuItem, 'id'>) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<Category>('drink');

  useEffect(() => {
    if (!visible) return;
    setName(item?.name ?? '');
    setPrice(item ? centsToInput(item.priceCents) : '');
    setCategory(item?.category ?? 'drink');
  }, [visible, item]);

  const priceCents = parsePrice(price);
  const valid = name.trim() !== '' && priceCents !== null;

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
          {item ? 'Item bewerken' : 'Nieuw item'}
        </Text>

        <Field value={name} onChangeText={setName} placeholder="Naam, bijv. Bier" autoFocus />
        <Field
          value={price}
          onChangeText={setPrice}
          placeholder="Prijs, bijv. 2,50"
          keyboardType="decimal-pad"
        />
        {price !== '' && priceCents === null ? (
          <Text style={{ color: theme.danger, fontSize: 13 }}>
            Dit is geen geldige prijs. Probeer bijvoorbeeld 2,50.
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {(['drink', 'food'] as Category[]).map((option) => {
            const selected = category === option;
            return (
              <Pressable
                key={option}
                onPress={() => setCategory(option)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  backgroundColor: selected ? theme.accent : theme.chip,
                }}>
                <Text
                  style={{
                    color: selected ? theme.onAccent : theme.text,
                    fontWeight: '600',
                  }}>
                  {option === 'drink' ? 'Drankje' : 'Eten'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title="Opslaan"
            disabled={!valid}
            onPress={() =>
              onSubmit({ name: name.trim(), priceCents: priceCents ?? 0, category })
            }
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}

/**
 * Open a modal from inside an Alert button.
 *
 * On iOS a modal presented while the alert is still animating away can fail to
 * appear at all: UIKit will not present one view controller while another is
 * being dismissed, and React Native does not try again. The screen then thinks
 * the PIN prompt is open while nothing is showing. Waiting out the alert's
 * dismissal avoids that. Android has no such problem, which is why it never
 * showed up in testing there.
 */
export function whenAlertClosed(open: () => void): void {
  if (Platform.OS === 'ios') setTimeout(open, 350);
  else open();
}

/** A row of mutually exclusive options, the selected one filled in. */
function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              paddingVertical: 12,
              paddingHorizontal: space.sm,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.accent : theme.chip,
            }}>
            <Text
              numberOfLines={2}
              style={{
                color: selected ? theme.onAccent : theme.text,
                fontWeight: '600',
                textAlign: 'center',
              }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Name a new list, and say whether it is an event or the season tab. */
export function NewListModal({
  visible,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (name: string, kind: ListKind) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListKind>('event');

  useEffect(() => {
    if (!visible) return;
    setName('');
    setKind('event');
  }, [visible]);

  if (!visible) return null;

  const submit = () => {
    if (name.trim() === '') return;
    onSubmit(name.trim(), kind);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Nieuwe lijst</Text>
        <Choice
          options={[
            { value: 'event', label: 'Evenement' },
            { value: 'tab', label: 'Lopende rekening' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }}>
          {kind === 'event'
            ? 'Voor één gelegenheid. Leden gaan op de factuur; gasten kunnen aan het eind van de avond betalen.'
            : 'Voor de gewone baravonden, het hele seizoen door. Alles gaat op de factuur van de penningmeester; aan de bar wordt niets afgerekend.'}
        </Text>
        <Field
          value={name}
          onChangeText={setName}
          placeholder={kind === 'event' ? "bijv. BBQ bij Sam's" : 'bijv. Baravonden'}
          autoFocus
          onSubmitEditing={submit}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title="Aanmaken"
            onPress={submit}
            disabled={name.trim() === ''}
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}

/**
 * Add a guest to an event: a plus-one with their own tab, or someone from
 * outside the group.
 *
 * Contact details are deliberately not asked for. Everything in a shared list
 * can be read on every phone that joined it, so a guest who wants to be
 * invoiced leaves their details with the treasurer, outside the app.
 */
export function GuestModal({
  visible,
  hosts,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  /** Members at the event whom a guest could have come with. */
  hosts: Person[];
  onCancel: () => void;
  onSubmit: (guest: { name: string; billing: Billing; guestOf: string | null }) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [billing, setBilling] = useState<Billing>('tonight');
  const [guestOf, setGuestOf] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setBilling('tonight');
    setGuestOf(null);
  }, [visible]);

  if (!visible) return null;

  const submit = () => {
    if (name.trim() === '') return;
    onSubmit({ name: name.trim(), billing, guestOf });
  };

  const hostOptions: { id: string | null; name: string }[] = [
    { id: null, name: 'Niemand' },
    ...hosts.map((host) => ({ id: host.id, name: host.name })),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Gast toevoegen</Text>
        <Field value={name} onChangeText={setName} placeholder="Naam" autoFocus />

        <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '700' }}>AFREKENEN</Text>
        <Choice
          options={[
            { value: 'tonight', label: 'Vanavond' },
            { value: 'invoice', label: 'Op factuur' },
          ]}
          value={billing}
          onChange={setBilling}
        />
        <Text style={{ color: theme.textDim, fontSize: 13, lineHeight: 18 }}>
          {billing === 'tonight'
            ? 'Aan het eind van de avond, via Tikkie of een betaalverzoek.'
            : 'Alleen als de gast zijn gegevens heeft achtergelaten. Geef die aan de penningmeester; ze staan niet in de app.'}
        </Text>

        {hosts.length > 0 ? (
          <>
            <Text style={{ color: theme.textDim, fontSize: 12, fontWeight: '700' }}>GAST VAN</Text>
            <ScrollView
              style={{ maxHeight: 160 }}
              contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {hostOptions.map((host) => {
                const selected = guestOf === host.id;
                return (
                  <Pressable
                    key={host.id ?? 'none'}
                    onPress={() => setGuestOf(host.id)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? theme.accent : theme.chip,
                    }}>
                    <Text
                      style={{ color: selected ? theme.onAccent : theme.text, fontWeight: '600' }}>
                      {host.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Annuleren" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title="Toevoegen"
            onPress={submit}
            disabled={name.trim() === ''}
            style={{ flex: 1 }}
          />
        </View>
      </Backdrop>
    </Modal>
  );
}

/**
 * Pick members from the season tab to add to an event.
 *
 * The chosen members are copied into the event, each linked to their row in
 * the tab by id, so their turfs here can go onto the same invoice. The event
 * never reads the tab after that, which is what keeps a phone that only joined
 * the event from seeing a season of everyone's drinks.
 */
export function MemberPickerModal({
  visible,
  tabs,
  alreadyIn,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  /** The tabs on this phone. Usually one. */
  tabs: AppEvent[];
  /** Member ids already in the event, including anyone since removed. */
  alreadyIn: string[];
  onCancel: () => void;
  onSubmit: (members: { id: string; name: string }[]) => void;
}) {
  const theme = useTheme();
  const [tabId, setTabId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setTabId(tabs[0]?.id ?? null);
    setChosen([]);
    // Only when opening: the tabs do not change while this is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const tab = tabs.find((candidate) => candidate.id === tabId) ?? tabs[0] ?? null;
  const taken = new Set(alreadyIn);
  const members = tab
    ? tab.people
        .filter((member) => member.removedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
    : [];
  const available = members.filter((member) => !taken.has(member.id));
  const allChosen =
    available.length > 0 && available.every((member) => chosen.includes(member.id));

  const toggle = (memberId: string) =>
    setChosen((current) =>
      current.includes(memberId)
        ? current.filter((candidate) => candidate !== memberId)
        : [...current, memberId]
    );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Backdrop onCancel={onCancel}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Leden toevoegen</Text>

        {tab === null ? (
          <Text style={{ color: theme.textDim, fontSize: 14, lineHeight: 20 }}>
            Er staat nog geen lopende rekening op deze telefoon. Doe mee aan die van de groep of
            maak er een aan; daarna kun je hier leden uit kiezen. Een gast kun je altijd toevoegen.
          </Text>
        ) : (
          <>
            {tabs.length > 1 ? (
              <Choice
                options={tabs.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                value={tab.id}
                onChange={(value) => {
                  setTabId(value);
                  setChosen([]);
                }}
              />
            ) : (
              <Text style={{ color: theme.textDim, fontSize: 13 }}>Uit {tab.name}</Text>
            )}

            {available.length > 0 ? (
              <Pressable
                onPress={() =>
                  setChosen(allChosen ? [] : available.map((member) => member.id))
                }
                hitSlop={8}>
                <Text style={{ color: theme.link, fontWeight: '600' }}>
                  {allChosen ? 'Niemand selecteren' : 'Iedereen selecteren'}
                </Text>
              </Pressable>
            ) : null}

            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: space.xs }}>
              {members.length === 0 ? (
                <Text style={{ color: theme.textDim, fontSize: 14 }}>
                  Deze rekening heeft nog geen leden.
                </Text>
              ) : null}
              {members.map((member) => {
                const inEvent = taken.has(member.id);
                const selected = chosen.includes(member.id);
                return (
                  <Pressable
                    key={member.id}
                    disabled={inEvent}
                    onPress={() => toggle(member.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingVertical: 10,
                      paddingHorizontal: space.sm,
                      borderRadius: radius.md,
                      backgroundColor: selected ? theme.chip : 'transparent',
                      opacity: inEvent ? 0.45 : 1,
                    }}>
                    <View style={{ width: 24, alignItems: 'center' }}>
                      {selected ? <CheckIcon size={20} color={theme.accent} /> : null}
                    </View>
                    <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
                      {member.name}
                    </Text>
                    {inEvent ? (
                      <Text style={{ color: theme.textDim, fontSize: 12 }}>al toegevoegd</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            title={tab === null ? 'Sluiten' : 'Annuleren'}
            variant="secondary"
            onPress={onCancel}
            style={{ flex: 1 }}
          />
          {tab !== null ? (
            <Button
              title={chosen.length === 0 ? 'Toevoegen' : `${chosen.length} toevoegen`}
              disabled={chosen.length === 0}
              onPress={() =>
                onSubmit(
                  members
                    .filter((member) => chosen.includes(member.id))
                    .map((member) => ({ id: member.id, name: member.name }))
                )
              }
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      </Backdrop>
    </Modal>
  );
}
