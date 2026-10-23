import React, { useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { RiskThresholds } from '../types/safety';
import { DEFAULT_THRESHOLDS } from '../engine/riskEngine';

interface RuleConfigPanelProps {
  thresholds: RiskThresholds;
  onSaveThresholds: (next: RiskThresholds) => void;
  onResetThresholds: () => void;
}

export const RuleConfigPanel: React.FC<RuleConfigPanelProps> = ({
  thresholds,
  onSaveThresholds,
  onResetThresholds,
}) => {
  const [draft, setDraft] = useState<RiskThresholds>(thresholds);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  const validateAndSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedBanner(false);

    if (
      draft.heartRate.criticalLow >= draft.heartRate.lowMin ||
      draft.heartRate.moderateHigh >= draft.heartRate.highHigh ||
      draft.heartRate.highHigh >= draft.heartRate.criticalHigh
    ) {
      setErrorMsg(
        'Invalid Heart Rate thresholds: Ensure Critical Low < Nominal Min, and Moderate High < High < Critical High.'
      );
      return;
    }

    if (
      draft.oxygenSaturation.highMin >= draft.oxygenSaturation.moderateMin ||
      draft.oxygenSaturation.moderateMin >= draft.oxygenSaturation.normalMin
    ) {
      setErrorMsg(
        'Invalid SpO2 thresholds: Ensure Critical Min < Moderate Min < Nominal Min.'
      );
      return;
    }

    if (
      draft.bodyTemp.lowHypothermia >= draft.bodyTemp.normalMin ||
      draft.bodyTemp.normalMax >= draft.bodyTemp.moderateMax ||
      draft.bodyTemp.moderateMax >= draft.bodyTemp.highMax
    ) {
      setErrorMsg(
        'Invalid Body Temperature thresholds: Ensure Hypothermia < Nominal Min and Nominal Max < High < Critical.'
      );
      return;
    }

    onSaveThresholds(draft);
    setSavedBanner(true);
  };

  const handleReset = () => {
    setDraft(DEFAULT_THRESHOLDS);
    setErrorMsg(null);
    setSavedBanner(false);
    onResetThresholds();
  };

  return (
    <section
      aria-labelledby="rule-config-heading"
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 id="rule-config-heading" className="text-lg font-semibold text-slate-900">
            Configurable Rule-Based Risk Engine
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Customize physiological and environmental cutoffs for Low, Moderate, High, and Critical risk classifications.
          </p>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Restore Default Rules</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium"
        >
          {errorMsg}
        </div>
      )}

      {savedBanner && (
        <div
          role="status"
          className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium"
        >
          Risk engine thresholds updated. Current telemetry has been re-evaluated against your custom rules.
        </div>
      )}

      <form onSubmit={validateAndSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Heart Rate Thresholds */}
          <div className="space-y-3 p-4 rounded-lg border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Heart Rate Thresholds (BPM)
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="hr-crit-low" className="block text-slate-600 mb-1">
                  Critical Bradycardia (&le;)
                </label>
                <input
                  id="hr-crit-low"
                  type="number"
                  value={draft.heartRate.criticalLow}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      heartRate: { ...draft.heartRate, criticalLow: Number(e.target.value) },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="hr-low-min" className="block text-slate-600 mb-1">
                  Nominal Floor (&ge;)
                </label>
                <input
                  id="hr-low-min"
                  type="number"
                  value={draft.heartRate.lowMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      heartRate: { ...draft.heartRate, lowMin: Number(e.target.value) },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="hr-mod-high" className="block text-slate-600 mb-1">
                  Moderate High (&ge;)
                </label>
                <input
                  id="hr-mod-high"
                  type="number"
                  value={draft.heartRate.moderateHigh}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      heartRate: { ...draft.heartRate, moderateHigh: Number(e.target.value) },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="hr-high-high" className="block text-slate-600 mb-1">
                  High Risk (&ge;)
                </label>
                <input
                  id="hr-high-high"
                  type="number"
                  value={draft.heartRate.highHigh}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      heartRate: { ...draft.heartRate, highHigh: Number(e.target.value) },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="hr-crit-high" className="block text-slate-600 mb-1">
                  Critical Tachycardia (&ge;)
                </label>
                <input
                  id="hr-crit-high"
                  type="number"
                  value={draft.heartRate.criticalHigh}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      heartRate: { ...draft.heartRate, criticalHigh: Number(e.target.value) },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Oxygen Saturation Thresholds */}
          <div className="space-y-3 p-4 rounded-lg border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Oxygen Saturation — SpO2 (%)
            </h3>
            <div className="grid grid-cols-1 gap-3 text-xs">
              <div>
                <label htmlFor="spo2-normal" className="block text-slate-600 mb-1">
                  Optimal Minimum (&ge; %)
                </label>
                <input
                  id="spo2-normal"
                  type="number"
                  value={draft.oxygenSaturation.normalMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      oxygenSaturation: {
                        ...draft.oxygenSaturation,
                        normalMin: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="spo2-mod" className="block text-slate-600 mb-1">
                  Moderate Floor (&ge; %)
                </label>
                <input
                  id="spo2-mod"
                  type="number"
                  value={draft.oxygenSaturation.moderateMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      oxygenSaturation: {
                        ...draft.oxygenSaturation,
                        moderateMin: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="spo2-crit" className="block text-slate-600 mb-1">
                  Critical Desaturation (&le; %)
                </label>
                <input
                  id="spo2-crit"
                  type="number"
                  value={draft.oxygenSaturation.highMin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      oxygenSaturation: {
                        ...draft.oxygenSaturation,
                        highMin: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Core Body Temperature Thresholds */}
          <div className="space-y-3 p-4 rounded-lg border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Core Body Temperature (°C)
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="bt-hypo" className="block text-slate-600 mb-1">
                  Critical Hypothermia (&le;)
                </label>
                <input
                  id="bt-hypo"
                  type="number"
                  step="0.1"
                  value={draft.bodyTemp.lowHypothermia}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bodyTemp: {
                        ...draft.bodyTemp,
                        lowHypothermia: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="bt-norm-max" className="block text-slate-600 mb-1">
                  Nominal Upper (&le;)
                </label>
                <input
                  id="bt-norm-max"
                  type="number"
                  step="0.1"
                  value={draft.bodyTemp.normalMax}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bodyTemp: {
                        ...draft.bodyTemp,
                        normalMax: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="bt-high" className="block text-slate-600 mb-1">
                  High Thermal Strain (&ge;)
                </label>
                <input
                  id="bt-high"
                  type="number"
                  step="0.1"
                  value={draft.bodyTemp.moderateMax}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bodyTemp: {
                        ...draft.bodyTemp,
                        moderateMax: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="bt-crit" className="block text-slate-600 mb-1">
                  Critical Hyperthermia (&ge;)
                </label>
                <input
                  id="bt-crit"
                  type="number"
                  step="0.1"
                  value={draft.bodyTemp.highMax}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bodyTemp: {
                        ...draft.bodyTemp,
                        highMax: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Ambient Temperature Thresholds */}
          <div className="space-y-3 p-4 rounded-lg border border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Ambient Temperature Thresholds (°C)
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="amb-cold-crit" className="block text-slate-600 mb-1">
                  Extreme Cold (&le;)
                </label>
                <input
                  id="amb-cold-crit"
                  type="number"
                  value={draft.ambientTemp.coldCritical}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ambientTemp: {
                        ...draft.ambientTemp,
                        coldCritical: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="amb-heat-warn" className="block text-slate-600 mb-1">
                  Warm Advisory (&ge;)
                </label>
                <input
                  id="amb-heat-warn"
                  type="number"
                  value={draft.ambientTemp.heatWarn}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ambientTemp: {
                        ...draft.ambientTemp,
                        heatWarn: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="amb-heat-high" className="block text-slate-600 mb-1">
                  High Heat Stress (&ge;)
                </label>
                <input
                  id="amb-heat-high"
                  type="number"
                  value={draft.ambientTemp.heatHigh}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ambientTemp: {
                        ...draft.ambientTemp,
                        heatHigh: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="amb-heat-crit" className="block text-slate-600 mb-1">
                  Critical Heat Hazard (&ge;)
                </label>
                <input
                  id="amb-heat-crit"
                  type="number"
                  value={draft.ambientTemp.heatCritical}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ambientTemp: {
                        ...draft.ambientTemp,
                        heatCritical: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono tabular-nums"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Save & Re-Evaluate Rules</span>
          </button>
        </div>
      </form>
    </section>
  );
};
