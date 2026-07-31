import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { COPY } from '@/constants/copy';
import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';
import {
  diagnosticsService,
  type DiagnosticsService,
  type DiagnosticsSnapshot,
} from '@/services/DiagnosticsService';
import { formatBinaryMegabytes } from '@/utils/file';
import { formatDuration } from '@/utils/time';

export interface DiagnosticsScreenProps {
  readonly service?: DiagnosticsService;
  readonly onClose: () => void;
}

interface DiagnosticRowProps {
  readonly label: string;
  readonly value: string;
}

function DiagnosticRow({ label, value }: DiagnosticRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

interface DiagnosticSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}

function DiagnosticSection({ title, children }: DiagnosticSectionProps) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function yesNo(value: boolean): string {
  return value ? COPY.diagnostics.yes : COPY.diagnostics.no;
}

function optional(value: string | null): string {
  return value ?? COPY.diagnostics.none;
}

function timeValue(milliseconds: number): string {
  return COPY.diagnostics.timeValue(formatDuration(milliseconds), milliseconds);
}

function rangeValue(startMs: number | null, endMs: number | null): string {
  if (startMs === null || endMs === null) {
    return COPY.diagnostics.none;
  }

  return COPY.diagnostics.activeRangeValue(timeValue(startMs), timeValue(endMs));
}

export function DiagnosticsScreen({
  service = diagnosticsService,
  onClose,
}: DiagnosticsScreenProps) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const isMountedRef = useRef(false);
  const collectionGenerationRef = useRef(0);

  const refresh = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    const generation = collectionGenerationRef.current + 1;
    collectionGenerationRef.current = generation;
    setIsLoading(true);
    setLoadFailed(false);
    void service
      .collect()
      .then((collectedSnapshot) => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setSnapshot(collectedSnapshot);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setIsLoading(false);
        }
      });
  }, [service]);

  useEffect(() => {
    isMountedRef.current = true;
    const generation = collectionGenerationRef.current + 1;
    collectionGenerationRef.current = generation;
    void service
      .collect()
      .then((collectedSnapshot) => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setSnapshot(collectedSnapshot);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (isMountedRef.current && collectionGenerationRef.current === generation) {
          setIsLoading(false);
        }
      });

    const unsubscribe = service.subscribeToLog(() => {
      if (!isMountedRef.current) {
        return;
      }

      setSnapshot((current) =>
        current === null ? current : { ...current, logEntries: service.getLogEntries() },
      );
    });

    return () => {
      isMountedRef.current = false;
      collectionGenerationRef.current += 1;
      unsubscribe();
    };
  }, [service]);

  const clearDiagnostics = useCallback(() => {
    service.clearRecordedDiagnostics();
    setSnapshot((current) =>
      current === null
        ? current
        : {
            ...current,
            native: { ...current.native, lastErrorCode: null },
            import: { ...current.import, lastErrorCode: null },
            logEntries: [],
          },
    );
  }, [service]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <AppButton label={COPY.diagnostics.back} onPress={onClose} variant="ghost" />
        <Text accessibilityRole="header" style={styles.title}>
          {COPY.diagnostics.title}
        </Text>
        <AppButton label={COPY.diagnostics.refresh} onPress={refresh} variant="ghost" />
      </View>

      {isLoading && snapshot === null ? (
        <View
          accessibilityLabel={COPY.diagnostics.loading}
          accessibilityRole="progressbar"
          style={styles.centered}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{COPY.diagnostics.loading}</Text>
        </View>
      ) : loadFailed && snapshot === null ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{COPY.diagnostics.loadError}</Text>
          <AppButton label={COPY.diagnostics.refresh} onPress={refresh} />
        </View>
      ) : snapshot === null ? null : (
        <ScrollView contentContainerStyle={styles.content}>
          <DiagnosticSection title={COPY.diagnostics.nativeSection}>
            <DiagnosticRow
              label={COPY.diagnostics.nativeAvailable}
              value={yesNo(snapshot.native.available)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.nativeApiVersion}
              value={
                snapshot.native.apiVersion === null
                  ? COPY.diagnostics.unavailable
                  : snapshot.native.apiVersion.toString()
              }
            />
            <DiagnosticRow
              label={COPY.diagnostics.lastNativeError}
              value={optional(snapshot.native.lastErrorCode)}
            />
          </DiagnosticSection>

          <DiagnosticSection title={COPY.diagnostics.playbackSection}>
            <DiagnosticRow label={COPY.diagnostics.playbackState} value={snapshot.playback.state} />
            <DiagnosticRow
              label={COPY.diagnostics.loadedFile}
              value={optional(snapshot.playback.loadedFileUri)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.selectedProject}
              value={optional(snapshot.playback.selectedProjectId)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.selectedSegment}
              value={
                snapshot.playback.selectedSegment === null
                  ? COPY.diagnostics.none
                  : COPY.diagnostics.segmentValue(snapshot.playback.selectedSegment)
              }
            />
            <DiagnosticRow
              label={COPY.diagnostics.selectedRate}
              value={COPY.diagnostics.rateValue(snapshot.playback.selectedRate)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.currentTime}
              value={timeValue(snapshot.playback.currentTimeMs)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.duration}
              value={timeValue(snapshot.playback.durationMs)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.actualRate}
              value={COPY.diagnostics.rateValue(snapshot.playback.rate)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.activeRange}
              value={rangeValue(
                snapshot.playback.activeRangeStartMs,
                snapshot.playback.activeRangeEndMs,
              )}
            />
          </DiagnosticSection>

          <DiagnosticSection title={COPY.diagnostics.storageSection}>
            <DiagnosticRow
              label={COPY.diagnostics.availableDisk}
              value={
                snapshot.storage.availableDiskBytes === null
                  ? COPY.diagnostics.unavailable
                  : formatBinaryMegabytes(snapshot.storage.availableDiskBytes)
              }
            />
          </DiagnosticSection>

          <DiagnosticSection title={COPY.diagnostics.repositorySection}>
            <DiagnosticRow
              label={COPY.diagnostics.projectSchema}
              value={COPY.diagnostics.schemaValue(snapshot.repository.projectSchemaVersion)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.waveformSchema}
              value={COPY.diagnostics.schemaValue(snapshot.repository.waveformSchemaVersion)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.repositoryInitialized}
              value={yesNo(snapshot.repository.initialized)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.projectCount}
              value={snapshot.repository.projectCount.toString()}
            />
            <DiagnosticRow
              label={COPY.diagnostics.repositoryLastError}
              value={optional(snapshot.repository.lastError)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.recoveryCodes}
              value={
                snapshot.repository.recoveryDiagnosticCodes.length === 0
                  ? COPY.diagnostics.none
                  : snapshot.repository.recoveryDiagnosticCodes.join(', ')
              }
            />
          </DiagnosticSection>

          <DiagnosticSection title={COPY.diagnostics.importSection}>
            <DiagnosticRow
              label={COPY.diagnostics.importActive}
              value={yesNo(snapshot.import.active)}
            />
            <DiagnosticRow
              label={COPY.diagnostics.lastImportError}
              value={optional(snapshot.import.lastErrorCode)}
            />
          </DiagnosticSection>

          <DiagnosticSection title={COPY.diagnostics.logSection}>
            {snapshot.logEntries.length === 0 ? (
              <Text style={styles.muted}>{COPY.diagnostics.logEmpty}</Text>
            ) : (
              [...snapshot.logEntries].reverse().map((entry) => (
                <View key={entry.sequence} style={styles.logEntry}>
                  <Text selectable style={styles.logHeading}>
                    {COPY.diagnostics.logHeading(
                      entry.timestampIso,
                      entry.level.toUpperCase(),
                      entry.event,
                    )}
                  </Text>
                  <Text selectable style={styles.logContext}>
                    {JSON.stringify(entry.context)}
                  </Text>
                </View>
              ))
            )}
            <AppButton
              disabled={snapshot.logEntries.length === 0}
              fullWidth
              label={COPY.diagnostics.clear}
              onPress={clearDiagnostics}
              variant="secondary"
            />
          </DiagnosticSection>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.bold,
  },
  row: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
    paddingTop: spacing.sm,
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.caption,
  },
  rowValue: {
    color: colors.text,
    fontSize: fontSizes.body,
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSizes.body,
  },
  error: {
    color: colors.danger,
    fontSize: fontSizes.body,
  },
  logEntry: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
    paddingTop: spacing.sm,
  },
  logHeading: {
    color: colors.text,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.semibold,
  },
  logContext: {
    color: colors.textMuted,
    fontFamily: 'Courier',
    fontSize: 12,
  },
});
