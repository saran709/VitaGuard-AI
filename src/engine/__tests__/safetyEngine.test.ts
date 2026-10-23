import { describe, expect, it } from 'vitest';
import {
  acknowledgeAlert,
  computeEscalationStage,
  createAlertFromAssessment,
  upsertAlertHistory,
} from '../alertManager';
import {
  DEFAULT_THRESHOLDS,
  evaluateRisk,
  SIMULATION_PRESETS,
} from '../riskEngine';
import {
  ActivityLevel,
  EscalationStage,
  RiskLevel,
  SafetyAlert,
  WeatherCondition,
} from '../../types/safety';

describe('VitaGuard AI — Risk Classification Engine', () => {
  it('classifies nominal resting readings in mild weather as LOW risk', () => {
    const nominalPreset = SIMULATION_PRESETS.find((p) => p.id === 'nominal-baseline')!;
    const assessment = evaluateRisk(nominalPreset.vitals, nominalPreset.environment);

    expect(assessment.riskLevel).toBe(RiskLevel.LOW);
    expect(assessment.physiologicalRisk).toBe(RiskLevel.LOW);
    expect(assessment.environmentalRisk).toBe(RiskLevel.LOW);
    expect(assessment.triggeredRules).toHaveLength(0);
  });

  it('classifies moderately elevated heart rate and warm humidity as MODERATE risk', () => {
    const moderatePreset = SIMULATION_PRESETS.find((p) => p.id === 'moderate-warm-walk')!;
    const assessment = evaluateRisk(moderatePreset.vitals, moderatePreset.environment);

    expect(assessment.riskLevel).toBe(RiskLevel.MODERATE);
    expect(assessment.triggeredRules.length).toBeGreaterThan(0);
    expect(assessment.triggeredRules.some((r) => r.severity === RiskLevel.MODERATE)).toBe(true);
  });

  it('classifies thermal strain and high heart rate as HIGH risk', () => {
    const highPreset = SIMULATION_PRESETS.find((p) => p.id === 'high-heat-strain')!;
    const assessment = evaluateRisk(highPreset.vitals, highPreset.environment);

    expect(assessment.riskLevel).toBe(RiskLevel.HIGH);
    expect(assessment.triggeredRules.some((r) => r.id === 'compound-exertional-heat')).toBe(true);
  });

  it('classifies severe hypoxia (SpO2 <= 88%) and hyperthermia as CRITICAL risk', () => {
    const criticalPreset = SIMULATION_PRESETS.find((p) => p.id === 'critical-hypoxia-heat')!;
    const assessment = evaluateRisk(criticalPreset.vitals, criticalPreset.environment);

    expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(assessment.physiologicalRisk).toBe(RiskLevel.CRITICAL);
    expect(assessment.triggeredRules.some((r) => r.id === 'spo2-critical')).toBe(true);
    expect(assessment.triggeredRules.some((r) => r.id === 'body-temp-critical')).toBe(true);
  });

  it('dynamically updates risk assessment when individual readings change', () => {
    const nominalPreset = SIMULATION_PRESETS.find((p) => p.id === 'nominal-baseline')!;
    const lowAssessment = evaluateRisk(nominalPreset.vitals, nominalPreset.environment);
    expect(lowAssessment.riskLevel).toBe(RiskLevel.LOW);

    // Increase heart rate to 150 BPM -> should transition to HIGH risk
    const elevatedVitals = { ...nominalPreset.vitals, heartRateBpm: 150 };
    const highAssessment = evaluateRisk(elevatedVitals, nominalPreset.environment);
    expect(highAssessment.riskLevel).toBe(RiskLevel.HIGH);

    // Drop SpO2 to 86% -> should transition to CRITICAL risk
    const criticalVitals = { ...elevatedVitals, oxygenSaturationPct: 86 };
    const criticalAssessment = evaluateRisk(criticalVitals, nominalPreset.environment);
    expect(criticalAssessment.riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('respects custom configurable rule thresholds when evaluating risk', () => {
    const customThresholds = {
      ...DEFAULT_THRESHOLDS,
      heartRate: {
        ...DEFAULT_THRESHOLDS.heartRate,
        criticalHigh: 125, // lowered critical threshold
      },
    };

    const assessment = evaluateRisk(
      {
        heartRateBpm: 130,
        oxygenSaturationPct: 98,
        bodyTempCelsius: 36.8,
        activityLevel: ActivityLevel.LIGHT_WALKING,
        stepCadencePerMin: 80,
      },
      {
        ambientTempCelsius: 21,
        humidityPct: 40,
        weatherCondition: WeatherCondition.CLEAR,
        windSpeedKmh: 5,
        airQualityIndex: 25,
      },
      customThresholds
    );

    expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL);
    expect(assessment.triggeredRules[0].id).toBe('hr-critical');
  });
});

describe('VitaGuard AI — Alert Creation, "I am safe" Acknowledgement & Alert History', () => {
  it('does not create an active alert when risk level is LOW', () => {
    const nominalPreset = SIMULATION_PRESETS.find((p) => p.id === 'nominal-baseline')!;
    const assessment = evaluateRisk(nominalPreset.vitals, nominalPreset.environment);
    const alert = createAlertFromAssessment(assessment, null);

    expect(alert).toBeNull();
  });

  it('creates an alert for high-risk scenarios, acknowledges via "I am safe", and updates alert history status', () => {
    const highPreset = SIMULATION_PRESETS.find((p) => p.id === 'high-heat-strain')!;
    const assessment = evaluateRisk(highPreset.vitals, highPreset.environment);
    const alert = createAlertFromAssessment(assessment, null, '2026-10-22T10:00:00.000Z');

    expect(alert).not.toBeNull();
    expect(alert!.acknowledged).toBe(false);
    expect(alert!.riskLevel).toBe(RiskLevel.HIGH);
    expect(alert!.escalationStage).toBe(EscalationStage.PROMPTED_USER);

    let history: SafetyAlert[] = upsertAlertHistory([], alert!);
    expect(history).toHaveLength(1);
    expect(history[0].acknowledged).toBe(false);

    // Progress escalation before acknowledgement
    const overdueStage = computeEscalationStage(alert!, 35);
    expect(overdueStage).toBe(EscalationStage.CHECK_IN_OVERDUE);

    const contactReadyStage = computeEscalationStage(alert!, 65);
    expect(contactReadyStage).toBe(EscalationStage.DEMO_CONTACT_READY);

    // Acknowledge with "I am safe"
    const { updatedAlert, timelineEvent } = acknowledgeAlert(
      alert!,
      'I am safe, resting in air conditioning now.',
      '2026-10-22T10:00:40.000Z'
    );

    history = upsertAlertHistory(history, updatedAlert);

    expect(updatedAlert.acknowledged).toBe(true);
    expect(updatedAlert.acknowledgedAt).toBe('2026-10-22T10:00:40.000Z');
    expect(updatedAlert.acknowledgementNote).toBe('I am safe, resting in air conditioning now.');
    expect(updatedAlert.escalationStage).toBe(EscalationStage.ACKNOWLEDGED_SAFE);
    expect(computeEscalationStage(updatedAlert, 120)).toBe(EscalationStage.ACKNOWLEDGED_SAFE);

    // Verify alert history reflects acknowledged status
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(alert!.id);
    expect(history[0].acknowledged).toBe(true);
    expect(history[0].escalationStage).toBe(EscalationStage.ACKNOWLEDGED_SAFE);

    // Verify timeline event
    expect(timelineEvent.type).toBe('user_acknowledged');
    expect(timelineEvent.title).toContain('I am safe');
  });
});
