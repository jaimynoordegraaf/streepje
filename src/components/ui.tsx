/**
 * Small building blocks reused across the screens, so the styling stays
 * consistent and the screens themselves stay readable.
 */

import { ReactNode } from 'react';
import {
  Pressable,
  StyleProp,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './text';

import { font, radius, space, useTheme } from '@/theme';

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.background }}>{children}</View>;
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: theme.border,
          padding: space.lg,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.textDim,
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: space.sm,
      }}>
      {children}
    </Text>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Given the label colour, so the icon always matches the text beside it. */
  icon?: (color: string, size: number) => ReactNode;
}) {
  const theme = useTheme();
  const background =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.chip;
  const color =
    variant === 'secondary' ? theme.text : variant === 'danger' ? theme.onDanger : theme.onAccent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          gap: space.sm,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}>
      {icon ? icon(color, 18) : null}
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

/** The round -/+ controls used for counting. */
export function StepButton({
  icon,
  onPress,
  tone = 'neutral',
  disabled = false,
}: {
  /** Given the resolved foreground colour, so it reads on either tone. */
  icon: (color: string, size: number) => ReactNode;
  onPress: () => void;
  tone?: 'neutral' | 'accent';
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        // The brand icons carry their own ring, so drawing another circle
        // behind them gives a double outline. The icon is the button; the box
        // only exists to keep the tap target comfortable.
        width: 46,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : pressed ? 0.55 : 1,
      })}>
      {icon(tone === 'accent' ? theme.accent : theme.textDim, 38)}
    </Pressable>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoFocus = false,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textDim}
      keyboardType={keyboardType}
      autoFocus={autoFocus}
      onSubmitEditing={onSubmitEditing}
      returnKeyType="done"
      style={{
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        paddingVertical: 12,
        fontSize: 16,
        color: theme.text,
        fontFamily: font.regular,
      }}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: 'center', gap: space.xs }}>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
      {hint ? (
        <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * Extra space to leave at the bottom of a scrolling screen.
 *
 * Android draws the app behind the system navigation / gesture bar
 * ("edge-to-edge"), so the last item would otherwise sit underneath it.
 */
export function useBottomInset(): number {
  return useSafeAreaInsets().bottom;
}

/** A fixed bar at the bottom of a screen, clear of the system navigation bar. */
export function BottomBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
        paddingBottom: space.lg + insets.bottom,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.card,
      }}>
      {children}
    </View>
  );
}

/** Header button, inset from the screen edge so it is never clipped. */
export function HeaderButton({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ paddingHorizontal: space.sm }}>
      {/* One line, so a long word cannot push the title out of the header. */}
      <Text numberOfLines={1} style={{ color: theme.link, fontSize: 15, fontWeight: '600' }}>
        {title}
      </Text>
    </Pressable>
  );
}
