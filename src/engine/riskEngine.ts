import {
  ActivityLevel,
  EnvironmentReadings,
  RiskAssessment,
  RiskLevel,
  RiskThresholds,
  SimulationPreset,
  TriggeredRule,
  VitalReadings,
  WeatherCondition,
} from '../types/safety';

export const RULE_ENGINE_VERSION = 'v1.2.0';

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  heartRate: {
    criticalLow: 42,
    lowMin: 50,
    moderateLow: 50,
    moderateHigh: 110,
    highHigh: 135,
    criticalHigh: 165,
  },
  oxygenSaturation: {
    normalMin: 95,
    moderateMin: 92,
    highMin: 88,
  },
  bodyTemp: {
    lowHypothermia: 35.0,
    normalMin: 36.1,
    normalMax: 37.5,
    moderateMax: 38.2,
    highMax: 39.2,
  },
  ambientTemp: {
    coldCritical: -5,
    coldWarn: 4,
    heatWarn: 30,
    heatHigh: 35,
    heatCritical: 40,
  },
};

export const SIMULATION_PRESETS: SimulationPreset[] = [
  {
    id: 'nominal-baseline',
    name: 'Nominal Daily Baseline',
    subtitle: 'Resting indoors under comfortable climate conditions',
    expectedRisk: RiskLevel.LOW,
    vitals: {
      heartRateBpm: 72,
      oxygenSaturationPct: 98,
      bodyTempCelsius: 36.8,
      activityLevel: ActivityLevel.RESTING,
      stepCadencePerMin: 0,
    },
    environment: {
      ambientTempCelsius: 22,
      humidityPct: 45,
      weatherCondition: WeatherCondition.CLEAR,
      windSpeedKmh: 8,
      airQualityIndex: 28,
    },
  },
  {
    id: 'moderate-warm-walk',
    name: 'Warm Afternoon Brisk Walk',
    subtitle: 'Elevated heart rate and warm humidity requiring hydration awareness',
    expectedRisk: RiskLevel.MODERATE,
    vitals: {
      heartRateBpm: 118,
      oxygenSaturationPct: 94,
      bodyTempCelsius: 37.8,
      activityLevel: ActivityLevel.MODERATE_EXERCISE,
      stepCadencePerMin: 108,
    },
    environment: {
      ambientTempCelsius: 30,
      humidityPct: 55,
      weatherCondition: WeatherCondition.HIGH_HUMIDITY,
      windSpeedKmh: 10,
      airQualityIndex: 62,
    },
  },
  {
    id: 'high-heat-strain',
    name: 'Thermal Strain & Exertion',
    subtitle: 'High ambient heat combined with elevated core temperature and tachycardia',
    expectedRisk: RiskLevel.HIGH,
    vitals: {
      heartRateBpm: 145,
      oxygenSaturationPct: 92,
      bodyTempCelsius: 38.5,
      activityLevel: ActivityLevel.INTENSE_EXERTION,
      stepCadencePerMin: 136,
    },
    environment: {
      ambientTempCelsius: 35,
      humidityPct: 50,
      weatherCondition: WeatherCondition.HEATWAVE,
      windSpeedKmh: 6,
      airQualityIndex: 95,
    },
  },
  {
    id: 'critical-hypoxia-heat',
    name: 'Critical Multi-Factor Emergency',
    subtitle: 'Severe oxygen desaturation, hyperthermia, and extreme heat stress',
    expectedRisk: RiskLevel.CRITICAL,
    vitals: {
      heartRateBpm: 174,
      oxygenSaturationPct: 85,
      bodyTempCelsius: 39.6,
      activityLevel: ActivityLevel.INTENSE_EXERTION,
      stepCadencePerMin: 145,
    },
    environment: {
      ambientTempCelsius: 42,
      humidityPct: 78,
      weatherCondition: WeatherCondition.HEATWAVE,
      windSpeedKmh: 5,
      airQualityIndex: 142,
    },
  },
  {
    id: 'cold-exposure-bradycardia',
    name: 'Cold Exposure & Low Core Temp',
    subtitle: 'Sub-zero freezing wind with core temperature drop and slowed heart rate',
    expectedRisk: RiskLevel.HIGH,
    vitals: {
      heartRateBpm: 46,
      oxygenSaturationPct: 93,
      bodyTempCelsius: 35.2,
      activityLevel: ActivityLevel.RESTING,
      stepCadencePerMin: 0,
    },
    environment: {
      ambientTempCelsius: -4,
      humidityPct: 55,
      weatherCondition: WeatherCondition.FREEZING_WIND,
      windSpeedKmh: 38,
      airQualityIndex: 30,
    },
  },
];

const SEVERITY_ORDER: Record<RiskLevel, number> = {
  [RiskLevel.LOW]: 0,
  [RiskLevel.MODERATE]: 1,
  [RiskLevel.HIGH]: 2,
  [RiskLevel.CRITICAL]: 3,
};

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/**
 * Computes simplified Steadman/Rothfusz heat index in Celsius when ambient temperature >= 26C.
 */
export function computeHeatIndexCelsius(ambientTempC: number, humidityPct: number): number {
  if (ambientTempC < 26) {
    return Number(ambientTempC.toFixed(1));
  }
  const tempF = (ambientTempC * 9) / 5 + 32;
  const rh = Math.max(0, Math.min(100, humidityPct));
  const hiF =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;

  const hiC = ((hiF - 32) * 5) / 9;
  return Number(Math.max(ambientTempC, hiC).toFixed(1));
}

/**
 * Pure, deterministic rule-based risk engine.
 * Evaluates simulated physiological and environmental telemetry against configurable thresholds.
 */
export function evaluateRisk(
  vitals: VitalReadings,
  environment: EnvironmentReadings,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
  evaluatedAt: string = new Date().toISOString()
): RiskAssessment {
  const triggeredRules: TriggeredRule[] = [];
  let physiologicalRisk: RiskLevel = RiskLevel.LOW;
  let environmentalRisk: RiskLevel = RiskLevel.LOW;

  // 1. Heart Rate Rules
  const hr = vitals.heartRateBpm;
  if (hr >= thresholds.heartRate.criticalHigh || hr <= thresholds.heartRate.criticalLow) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.CRITICAL);
    triggeredRules.push({
      id: 'hr-critical',
      category: 'physiological',
      title: hr >= thresholds.heartRate.criticalHigh ? 'Critical Tachycardia Threshold Exceeded' : 'Critical Bradycardia Threshold Crossed',
      severity: RiskLevel.CRITICAL,
      metricLabel: 'Heart Rate',
      observedValue: `${hr} BPM`,
      thresholdReference: `<= ${thresholds.heartRate.criticalLow} or >= ${thresholds.heartRate.criticalHigh} BPM`,
      scoreContribution: 45,
      rationale:
        hr >= thresholds.heartRate.criticalHigh
          ? `Simulated heart rate (${hr} BPM) is at or above the critical upper limit (${thresholds.heartRate.criticalHigh} BPM).`
          : `Simulated heart rate (${hr} BPM) has fallen to or below the critical lower threshold (${thresholds.heartRate.criticalLow} BPM).`,
    });
  } else if (hr >= thresholds.heartRate.highHigh || hr < thresholds.heartRate.lowMin) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.HIGH);
    triggeredRules.push({
      id: 'hr-high',
      category: 'physiological',
      title: hr >= thresholds.heartRate.highHigh ? 'High Heart Rate Elevation' : 'Markedly Low Heart Rate',
      severity: RiskLevel.HIGH,
      metricLabel: 'Heart Rate',
      observedValue: `${hr} BPM`,
      thresholdReference: `< ${thresholds.heartRate.lowMin} or >= ${thresholds.heartRate.highHigh} BPM`,
      scoreContribution: 25,
      rationale: `Simulated heart rate (${hr} BPM) is outside the high-safety boundary.`,
    });
  } else if (hr >= thresholds.heartRate.moderateHigh) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.MODERATE);
    triggeredRules.push({
      id: 'hr-moderate',
      category: 'physiological',
      title: 'Moderately Elevated Heart Rate',
      severity: RiskLevel.MODERATE,
      metricLabel: 'Heart Rate',
      observedValue: `${hr} BPM`,
      thresholdReference: `>= ${thresholds.heartRate.moderateHigh} BPM`,
      scoreContribution: 12,
      rationale: `Simulated heart rate (${hr} BPM) exceeds resting baseline (${thresholds.heartRate.moderateHigh} BPM).`,
    });
  }

  // 2. Oxygen Saturation (SpO2) Rules
  const spo2 = vitals.oxygenSaturationPct;
  if (spo2 <= thresholds.oxygenSaturation.highMin) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.CRITICAL);
    triggeredRules.push({
      id: 'spo2-critical',
      category: 'physiological',
      title: 'Critical Oxygen Desaturation',
      severity: RiskLevel.CRITICAL,
      metricLabel: 'SpO2',
      observedValue: `${spo2}%`,
      thresholdReference: `<= ${thresholds.oxygenSaturation.highMin}%`,
      scoreContribution: 50,
      rationale: `Simulated blood oxygen saturation (${spo2}%) is critically low (<= ${thresholds.oxygenSaturation.highMin}%).`,
    });
  } else if (spo2 < thresholds.oxygenSaturation.moderateMin) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.HIGH);
    triggeredRules.push({
      id: 'spo2-high',
      category: 'physiological',
      title: 'Low Blood Oxygen Saturation',
      severity: RiskLevel.HIGH,
      metricLabel: 'SpO2',
      observedValue: `${spo2}%`,
      thresholdReference: `< ${thresholds.oxygenSaturation.moderateMin}%`,
      scoreContribution: 28,
      rationale: `Simulated oxygen saturation (${spo2}%) has dropped below the safe moderate floor (${thresholds.oxygenSaturation.moderateMin}%).`,
    });
  } else if (spo2 < thresholds.oxygenSaturation.normalMin) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.MODERATE);
    triggeredRules.push({
      id: 'spo2-moderate',
      category: 'physiological',
      title: 'Borderline Oxygen Saturation',
      severity: RiskLevel.MODERATE,
      metricLabel: 'SpO2',
      observedValue: `${spo2}%`,
      thresholdReference: `< ${thresholds.oxygenSaturation.normalMin}%`,
      scoreContribution: 12,
      rationale: `Simulated SpO2 (${spo2}%) is slightly below the optimal range (${thresholds.oxygenSaturation.normalMin}%–100%).`,
    });
  }

  // 3. Body Temperature Rules
  const bodyTemp = vitals.bodyTempCelsius;
  if (bodyTemp >= thresholds.bodyTemp.highMax || bodyTemp <= thresholds.bodyTemp.lowHypothermia) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.CRITICAL);
    triggeredRules.push({
      id: 'body-temp-critical',
      category: 'physiological',
      title:
        bodyTemp >= thresholds.bodyTemp.highMax
          ? 'Critical Core Hyperthermia Risk'
          : 'Critical Core Hypothermia Risk',
      severity: RiskLevel.CRITICAL,
      metricLabel: 'Body Temperature',
      observedValue: `${bodyTemp.toFixed(1)}°C`,
      thresholdReference: `<= ${thresholds.bodyTemp.lowHypothermia.toFixed(1)}°C or >= ${thresholds.bodyTemp.highMax.toFixed(1)}°C`,
      scoreContribution: 45,
      rationale:
        bodyTemp >= thresholds.bodyTemp.highMax
          ? `Simulated core temperature (${bodyTemp.toFixed(1)}°C) exceeds the critical threshold (${thresholds.bodyTemp.highMax.toFixed(1)}°C).`
          : `Simulated core temperature (${bodyTemp.toFixed(1)}°C) has dropped to or below the hypothermia threshold (${thresholds.bodyTemp.lowHypothermia.toFixed(1)}°C).`,
    });
  } else if (bodyTemp >= thresholds.bodyTemp.moderateMax || bodyTemp < thresholds.bodyTemp.normalMin - 0.5) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.HIGH);
    triggeredRules.push({
      id: 'body-temp-high',
      category: 'physiological',
      title:
        bodyTemp >= thresholds.bodyTemp.moderateMax
          ? 'Significant Core Temperature Elevation'
          : 'Low Core Body Temperature',
      severity: RiskLevel.HIGH,
      metricLabel: 'Body Temperature',
      observedValue: `${bodyTemp.toFixed(1)}°C`,
      thresholdReference: `< ${(thresholds.bodyTemp.normalMin - 0.5).toFixed(1)}°C or >= ${thresholds.bodyTemp.moderateMax.toFixed(1)}°C`,
      scoreContribution: 24,
      rationale: `Simulated body temperature (${bodyTemp.toFixed(1)}°C) indicates marked thermal strain.`,
    });
  } else if (bodyTemp > thresholds.bodyTemp.normalMax || bodyTemp < thresholds.bodyTemp.normalMin) {
    physiologicalRisk = maxRiskLevel(physiologicalRisk, RiskLevel.MODERATE);
    triggeredRules.push({
      id: 'body-temp-moderate',
      category: 'physiological',
      title: 'Mild Core Temperature Deviation',
      severity: RiskLevel.MODERATE,
      metricLabel: 'Body Temperature',
      observedValue: `${bodyTemp.toFixed(1)}°C`,
      thresholdReference: `${thresholds.bodyTemp.normalMin.toFixed(1)}°C – ${thresholds.bodyTemp.normalMax.toFixed(1)}°C`,
      scoreContribution: 10,
      rationale: `Simulated body temperature (${bodyTemp.toFixed(1)}°C) is outside the nominal range.`,
    });
  }

  // 4. Environmental Rules
  const ambTemp = environment.ambientTempCelsius;
  const heatIndex = computeHeatIndexCelsius(ambTemp, environment.humidityPct);

  if (ambTemp >= thresholds.ambientTemp.heatCritical || heatIndex >= 46 || ambTemp <= thresholds.ambientTemp.coldCritical) {
    environmentalRisk = maxRiskLevel(environmentalRisk, RiskLevel.CRITICAL);
    triggeredRules.push({
      id: 'env-temp-critical',
      category: 'environmental',
      title:
        ambTemp <= thresholds.ambientTemp.coldCritical
          ? 'Extreme Cold Ambient Exposure'
          : 'Extreme Heat & Thermal Index Hazard',
      severity: RiskLevel.CRITICAL,
      metricLabel: 'Ambient / Heat Index',
      observedValue: `${ambTemp}°C (Feels ${heatIndex}°C)`,
      thresholdReference: `<= ${thresholds.ambientTemp.coldCritical}°C or >= ${thresholds.ambientTemp.heatCritical}°C`,
      scoreContribution: 35,
      rationale: `Ambient temperature (${ambTemp}°C, heat index ${heatIndex}°C) poses an immediate environmental exposure hazard.`,
    });
  } else if (
    ambTemp >= thresholds.ambientTemp.heatHigh ||
    heatIndex >= 38 ||
    ambTemp <= thresholds.ambientTemp.coldWarn ||
    environment.weatherCondition === WeatherCondition.HEATWAVE ||
    environment.weatherCondition === WeatherCondition.FREEZING_WIND
  ) {
    environmentalRisk = maxRiskLevel(environmentalRisk, RiskLevel.HIGH);
    triggeredRules.push({
      id: 'env-temp-high',
      category: 'environmental',
      title: 'High Environmental Exposure Stress',
      severity: RiskLevel.HIGH,
      metricLabel: 'Ambient / Weather',
      observedValue: `${ambTemp}°C · ${environment.weatherCondition.replace(/_/g, ' ')}`,
      thresholdReference: `<= ${thresholds.ambientTemp.coldWarn}°C or >= ${thresholds.ambientTemp.heatHigh}°C`,
      scoreContribution: 20,
      rationale: `Adverse weather (${environment.weatherCondition.replace(/_/g, ' ')}) or ambient temperature (${ambTemp}°C, heat index ${heatIndex}°C) elevates environmental risk.`,
    });
  } else if (
    ambTemp >= thresholds.ambientTemp.heatWarn ||
    environment.humidityPct >= 75 ||
    environment.weatherCondition === WeatherCondition.HIGH_HUMIDITY ||
    environment.weatherCondition === WeatherCondition.HEAVY_RAIN
  ) {
    environmentalRisk = maxRiskLevel(environmentalRisk, RiskLevel.MODERATE);
    triggeredRules.push({
      id: 'env-temp-moderate',
      category: 'environmental',
      title: 'Moderate Environmental Strain',
      severity: RiskLevel.MODERATE,
      metricLabel: 'Ambient / Humidity',
      observedValue: `${ambTemp}°C · ${environment.humidityPct}% RH`,
      thresholdReference: `>= ${thresholds.ambientTemp.heatWarn}°C or >= 75% RH`,
      scoreContribution: 10,
      rationale: `Warm ambient conditions or high humidity (${environment.humidityPct}%) reduce evaporative cooling efficiency.`,
    });
  }

  // 5. Compound Cross-Domain Rules (Physiological + Environmental / Activity Interaction)
  const isHighExertion =
    vitals.activityLevel === ActivityLevel.INTENSE_EXERTION ||
    vitals.activityLevel === ActivityLevel.MODERATE_EXERCISE;

  if (
    isHighExertion &&
    (ambTemp >= thresholds.ambientTemp.heatWarn || heatIndex >= 32) &&
    (hr >= thresholds.heartRate.moderateHigh || bodyTemp > thresholds.bodyTemp.normalMax)
  ) {
    let compoundSeverity: RiskLevel = RiskLevel.MODERATE;
    if (
      heatIndex >= 42 &&
      hr >= thresholds.heartRate.criticalHigh &&
      bodyTemp >= thresholds.bodyTemp.highMax
    ) {
      compoundSeverity = RiskLevel.CRITICAL;
    } else if (
      heatIndex >= 36 ||
      vitals.activityLevel === ActivityLevel.INTENSE_EXERTION ||
      hr >= thresholds.heartRate.highHigh ||
      bodyTemp >= thresholds.bodyTemp.moderateMax
    ) {
      compoundSeverity = RiskLevel.HIGH;
    }

    triggeredRules.push({
      id: 'compound-exertional-heat',
      category: 'compound',
      title: 'Compound Exertional Heat Strain',
      severity: compoundSeverity,
      metricLabel: 'Exertion + Heat Index',
      observedValue: `${vitals.activityLevel.replace(/_/g, ' ')} @ ${heatIndex}°C HI`,
      thresholdReference: 'Active exertion during elevated Heat Index + rising HR/Core Temp',
      scoreContribution:
        compoundSeverity === RiskLevel.CRITICAL
          ? 28
          : compoundSeverity === RiskLevel.HIGH
          ? 18
          : 10,
      rationale: `Physical exertion (${vitals.activityLevel.replace(/_/g, ' ')}) combined with a ${heatIndex}°C heat index and elevated vitals accelerates thermal load.`,
    });
  }

  if (
    vitals.activityLevel === ActivityLevel.RESTING &&
    hr >= thresholds.heartRate.highHigh
  ) {
    triggeredRules.push({
      id: 'compound-resting-tachycardia',
      category: 'compound',
      title: 'Unexplained Resting Tachycardia',
      severity: RiskLevel.HIGH,
      metricLabel: 'HR vs. Activity',
      observedValue: `${hr} BPM while Resting`,
      thresholdReference: `< ${thresholds.heartRate.highHigh} BPM at rest`,
      scoreContribution: 22,
      rationale: `Simulated heart rate (${hr} BPM) is abnormally elevated despite resting activity status.`,
    });
  }

  // Determine overall risk level
  let overallRisk = maxRiskLevel(physiologicalRisk, environmentalRisk);
  for (const rule of triggeredRules) {
    overallRisk = maxRiskLevel(overallRisk, rule.severity);
  }

  const rawScore = triggeredRules.reduce((sum, rule) => sum + rule.scoreContribution, 0);
  const overallScore = Math.min(100, Math.max(4, rawScore === 0 ? 8 : rawScore));

  const sortedRules = [...triggeredRules].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.scoreContribution - a.scoreContribution
  );

  const primaryConcern =
    sortedRules.length > 0
      ? sortedRules[0].title
      : 'All simulated physiological and environmental indicators are within nominal parameters.';

  return {
    riskLevel: overallRisk,
    overallScore,
    physiologicalRisk,
    environmentalRisk,
    heatIndexCelsius: heatIndex,
    triggeredRules: sortedRules,
    primaryConcern,
    evaluatedAt,
    ruleVersion: RULE_ENGINE_VERSION,
  };
}
