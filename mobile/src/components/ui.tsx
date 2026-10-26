import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  ink: '#1f3029',
  muted: '#75827a',
  primary: '#2f765a',
  primaryStrong: '#153d30',
  accent: '#d8e78a',
  accentSoft: '#edf5ef',
  background: '#f5f7f5',
  border: '#e2e8e2',
  white: '#ffffff',
  danger: '#b5473a',
  dangerSoft: '#fdf0ee',
  green: '#087443',
};

export function Page({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel || label}
        placeholderTextColor="#97a0ae"
        style={[styles.input, props.multiline && styles.multiline, props.style]}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger, disabled && styles.disabled]}
    >
      {disabled ? <ActivityIndicator color={secondary ? colors.primary : colors.white} /> : <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText, danger && styles.buttonDangerText]}>{title}</Text>}
    </Pressable>
  );
}

export function Message({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <Text style={[styles.message, error && styles.error]}>{children}</Text>;
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { alignSelf: 'center', width: '100%', maxWidth: 720, flexGrow: 1, padding: 18, paddingBottom: 40, gap: 14 },
  heading: { marginBottom: 3, gap: 4 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2, lineHeight: 20 },
  card: { backgroundColor: colors.white, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, gap: 11, shadowColor: '#153d30', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.035, shadowRadius: 8, elevation: 1 },
  field: { gap: 6, flex: 1 },
  label: { color: '#52675a', fontSize: 12, fontWeight: '600' },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.white, paddingHorizontal: 12, color: colors.ink, fontSize: 15 },
  multiline: { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 },
  button: { minHeight: 46, paddingHorizontal: 16, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: colors.accentSoft },
  buttonDanger: { backgroundColor: colors.dangerSoft },
  buttonText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  buttonSecondaryText: { color: colors.primary },
  buttonDangerText: { color: colors.danger },
  disabled: { opacity: 0.6 },
  message: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
