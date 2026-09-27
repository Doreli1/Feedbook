import { Text, View } from 'react-native';
import { colors } from '../theme';

interface Step {
  label: string;
  // 'done' vs a number only decides the segment's color (green vs blue) —
  // the number itself is no longer rendered here. It used to show as a
  // small badge next to the label, but the diner-app owner asked (2026-09-11)
  // to move that live count onto the bottom continue button instead, so the
  // caller still passes the real count for color purposes even though this
  // component itself never displays it.
  status: 'done' | number;
}

// The two-step progress bar under the header on the add-participants /
// table-session screens (mockups 6.1, 6.2, 6.3) — a passive status readout
// here, not a tappable tab switcher: the real seat-selection step has no
// live interactive map behind it (RLS deliberately blocks a diner from
// browsing a restaurant's tables — see scan-qr/index.ts), so presenting it
// as a switchable tab would point at something that isn't really there.
//
// Redesigned 2026-09-11 to match the Web Admin's own registration-wizard
// stepper (WizardStepper.tsx: label above, colored segment below, done
// segments visually distinct from the current one) instead of the original
// small circle-plus-label row — same underlying idea, bigger footprint per
// the diner-app owner's own request. Green specifically (not the web
// stepper's accent color) marks a completed/saved step here, per that same
// request — a deliberate divergence from the web version's palette, not an
// inconsistency.
export function StepTabs({ steps }: { steps: [Step, Step] }) {
  return (
    <View className="border-b px-4 pb-3 pt-4" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
      {/* Explicit percentage width per column instead of flex-1 — the
          bar underneath (an empty leaf View with no intrinsic content)
          was collapsing to zero width in real-device testing (2026-09-11)
          when it had to rely on flex-stretch to size itself. Fixed
          percentages + justify-between sidestep that entirely and also
          guarantee the two columns sit at an equal, symmetric distance
          from the screen edges regardless of how long either label is. */}
      <View className="flex-row justify-between">
        {steps.map((step) => {
          const isDone = step.status === 'done';
          return (
            <View key={step.label} style={{ width: '44%', alignItems: 'center' }}>
              <Text className="mb-2 text-center text-base font-semibold text-[#1B2430]" numberOfLines={1}>
                {step.label}
              </Text>
              <View
                className="rounded-full"
                style={{ height: 6, width: '100%', backgroundColor: isDone ? colors.success : colors.royalBlue }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}
