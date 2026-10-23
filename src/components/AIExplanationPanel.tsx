import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  DataSourceMode,
  EnvironmentReadings,
  ExplanationReport,
  PersistedAIExplanation,
  RiskAssessment,
  RiskLevel,
  VitalReadings,
} from '../types/safety';
import {
  AIExplanationServiceError,
  computeAssessmentFingerprint,
  sanitizeUntrustedUserNote,
} from '../services/geminiExplanationEngine';
import { requestContextualAIExplanation } from '../services/explanationService';

interface AIExplanationPanelProps {
  assessment: RiskAssessment;
  explanation: ExplanationReport;
  vitals?: VitalReadings;
  environment?: EnvironmentReadings;
  activeUid?: string;
  sourceDataMode?: DataSourceMode;
  persistedAIExplanation?: PersistedAIExplanation | null;
  onAIExplanationGenerated?: (aiExp: PersistedAIExplanation) => void;
}

const SEVERITY_TEXT: Record<RiskLevel, string> = {
  [RiskLevel.LOW]: 'text-emerald-700 font-semibold',
  [RiskLevel.MODERATE]: 'text-amber-700 font-semibold',
  [RiskLevel.HIGH]: 'text-orange-700 font-semibold',
  [RiskLevel.CRITICAL]: 'text-red-700 font-semibold',
};

export const AIExplanationPanel: React.FC<AIExplanationPanelProps> = ({
  assessment,
  explanation,
  vitals,
  environment,
  activeUid = 'operator-default-uid',
  sourceDataMode = 'SIMULATED',
  persistedAIExplanation = null,
  onAIExplanationGenerated,
}) => {
  const [userNote, setUserNote] = useState<string>('');
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [aiError, setAiError] = useState<{ code: string; message: string } | null>(
    null
  );
  const [localAIExplanation, setLocalAIExplanation] =
    useState<PersistedAIExplanation | null>(persistedAIExplanation);

  const activeAIExplanation = persistedAIExplanation ?? localAIExplanation;

  const currentSanitizedNote = (() => {
    try {
      return sanitizeUntrustedUserNote(userNote).sanitizedNote;
    } catch {
      return '';
    }
  })();

  const currentFingerprint = computeAssessmentFingerprint(
    assessment,
    vitals,
    environment,
    sourceDataMode,
    currentSanitizedNote
  );

  const isAssessmentMateriallyChanged = Boolean(
    activeAIExplanation &&
      activeAIExplanation.assessmentFingerprint !== currentFingerprint
  );

  const handleRequestExplanation = async (forceRegenerate: boolean = false) => {
    setIsLoadingAI(true);
    setAiError(null);

    try {
      const assessmentId = `risk-${assessment.riskLevel}-${assessment.overallScore}`;
      const result = await requestContextualAIExplanation({
        actingUid: activeUid,
        targetUid: activeUid,
        assessmentId,
        assessment,
        vitals,
        environment,
        sourceDataMode,
        userNote: userNote.trim() || undefined,
        forceRegenerate,
      });

      setLocalAIExplanation(result);
      onAIExplanationGenerated?.(result);
    } catch (err) {
      if (err instanceof AIExplanationServiceError) {
        setAiError({ code: err.code, message: err.message });
      } else {
        const msg =
          err instanceof Error
            ? err.message
            : 'AI explanation service is currently unavailable.';
        setAiError({ code: 'AI_SERVICE_UNAVAILABLE', message: msg });
      }
    } finally {
      setIsLoadingAI(false);
    }
  };

  return (
    <section
      aria-labelledby="ai-explanation-heading"
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
    >
      {/* Top Header with Data Mode Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="ai-explanation-heading"
              className="text-lg font-semibold text-slate-900"
            >
              Safety Explanation & Rule Traceability
            </h2>
            <span
              className={`px-2 py-0.5 text-[11px] font-mono font-semibold uppercase rounded border ${
                sourceDataMode === 'SIMULATED'
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-300'
              }`}
            >
              SOURCE DATA: {sourceDataMode}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {explanation.confidenceNote}
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
          Evaluated: {new Date(explanation.generatedAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Server-Side Gemini AI Contextual Explanation Module */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Sparkles className="w-4 h-4 text-slate-700" aria-hidden="true" />
              <span>Contextual AI Assessment Explanation (Gemini 3.8 Flash)</span>
            </div>
            <p className="text-xs text-slate-600">
              Explains the deterministic risk engine output via a server-authenticated endpoint without altering risk classification ({assessment.riskLevel.toUpperCase()} · {assessment.overallScore}/100).
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isLoadingAI}
              onClick={() =>
                handleRequestExplanation(Boolean(isAssessmentMateriallyChanged))
              }
              className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors inline-flex items-center gap-1.5"
            >
              {isLoadingAI ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Generating explanation...</span>
                </>
              ) : activeAIExplanation && isAssessmentMateriallyChanged ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Explain updated assessment</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Explain this assessment</span>
                </>
              )}
            </button>

            {activeAIExplanation && !isLoadingAI && (
              <button
                type="button"
                onClick={() => handleRequestExplanation(true)}
                title="Force regenerate AI explanation"
                className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        </div>

        {/* Optional User Note Input (treated strictly as untrusted data) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <label htmlFor="ai-user-context-note" className="font-medium">
              Optional Situational Note (analyzed as untrusted context data; cannot override rules)
            </label>
            <span className="font-mono tabular-nums">{userNote.length}/240</span>
          </div>
          <input
            id="ai-user-context-note"
            type="text"
            maxLength={240}
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            placeholder="e.g., Currently resting indoors after outdoor walk in warm weather..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Loading State */}
        {isLoadingAI && (
          <div
            role="status"
            aria-live="polite"
            className="p-4 rounded-lg bg-white border border-slate-200 flex items-center gap-3 text-xs text-slate-700"
          >
            <Loader2 className="w-4 h-4 animate-spin text-slate-900 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">
                Requesting validated explanation from server-side Gemini...
              </div>
              <div className="text-slate-500 mt-0.5">
                Authoritative deterministic classification ({assessment.riskLevel.toUpperCase()}) remains active during synthesis.
              </div>
            </div>
          </div>
        )}

        {/* Error & Retry State (Never fabricates AI output; keeps deterministic explanation visible) */}
        {aiError && !isLoadingAI && (
          <div
            role="alert"
            className="p-4 rounded-lg bg-amber-50 border border-amber-300 space-y-2.5 text-xs text-amber-950"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">
                    AI Explanation Service Notice ({aiError.code})
                  </div>
                  <p className="text-amber-900 mt-0.5 leading-relaxed">
                    {aiError.message}
                  </p>
                  <p className="text-[11px] text-amber-800 mt-1">
                    No fabricated AI response was generated. The authoritative deterministic rule engine explanation below remains active and unchanged.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRequestExplanation(true)}
                className="px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-800 transition-colors shrink-0 inline-flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {/* Structured Validated AI Explanation Output */}
        {activeAIExplanation && !isLoadingAI && (
          <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Validated AI Explanation
                </span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded border ${
                    activeAIExplanation.dataMode === 'SIMULATED'
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  }`}
                >
                  Data Mode: {activeAIExplanation.dataMode}
                </span>
                {activeAIExplanation.cached && (
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-700 rounded border border-slate-200">
                    Cached for unchanged assessment
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-500">
                <Clock className="w-3 h-3" aria-hidden="true" />
                <span>
                  Generated:{' '}
                  {new Date(activeAIExplanation.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {isAssessmentMateriallyChanged && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-900">
                <span>
                  Underlying readings or notes have changed since this explanation was generated.
                </span>
                <button
                  type="button"
                  onClick={() => handleRequestExplanation(true)}
                  className="font-semibold underline shrink-0"
                >
                  Regenerate now
                </button>
              </div>
            )}

            {/* AI Summary */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-slate-900">
                Assessment Summary
              </h4>
              <p className="text-xs text-slate-700 leading-relaxed">
                {activeAIExplanation.summary}
              </p>
            </div>

            {/* Contributing Factors & Uncertainties Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-900">
                  Contributing Factors ({activeAIExplanation.contributingFactors.length})
                </h4>
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-700">
                  {activeAIExplanation.contributingFactors.map((factor, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {factor}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                  <span>
                    Uncertainties & Missing/Simulated Data ({activeAIExplanation.uncertainties.length})
                  </span>
                </h4>
                <ul className="list-disc list-inside space-y-1 text-xs text-slate-700">
                  {activeAIExplanation.uncertainties.map((unc, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {unc}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* AI Triggered Rule Explanations */}
            {activeAIExplanation.triggeredRules.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-900">
                  AI Rule-by-Rule Context ({activeAIExplanation.triggeredRules.length})
                </h4>
                <div className="space-y-1.5">
                  {activeAIExplanation.triggeredRules.map((tr) => (
                    <div
                      key={tr.id}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                    >
                      <span className="font-mono font-semibold text-slate-900">
                        [{tr.id}]
                      </span>{' '}
                      <span className="text-slate-700">{tr.explanation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Suggested General Safety Actions */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-slate-900">
                Suggested General Safety Actions (Non-Diagnostic)
              </h4>
              <ol className="list-decimal list-inside space-y-1 text-xs text-slate-700">
                {activeAIExplanation.recommendedActions.map((act, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {act}
                  </li>
                ))}
              </ol>
            </div>

            {/* Limitations & Metadata Footer */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
                <span>{activeAIExplanation.limitations}</span>
              </div>
              <span className="font-mono whitespace-nowrap shrink-0 text-slate-600">
                Model: {activeAIExplanation.modelId} · {activeAIExplanation.promptVersion}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Deterministic Engine Baseline Explanation (Always Active & Authoritative) */}
      <div className="space-y-2">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Authoritative Deterministic Engine Synthesis
        </div>
        <h3 className="text-base font-bold text-slate-900">
          {explanation.headline}
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed">
          {explanation.executiveSummary}
        </p>
      </div>

      {/* 2-Column Correlation Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900">
            Physiological Signal Correlation
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            {explanation.physiologicalCorrelation}
          </p>
        </div>
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900">
            Environmental & Micro-Climate Context
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            {explanation.environmentalContext}
          </p>
        </div>
      </div>

      {/* Triggered Rule Breakdown Table */}
      <div className="space-y-2.5 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-900">
            Triggered Risk Factors ({assessment.triggeredRules.length})
          </h4>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Composite Score: {assessment.overallScore}/100
          </span>
        </div>

        {assessment.triggeredRules.length === 0 ? (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            Zero threshold rules triggered. All physiological and environmental signals are within configured low-risk parameters.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">Rule / Factor</th>
                  <th className="py-2.5 px-3 font-semibold">Domain</th>
                  <th className="py-2.5 px-3 font-semibold">Observed</th>
                  <th className="py-2.5 px-3 font-semibold">Threshold</th>
                  <th className="py-2.5 px-3 font-semibold">Severity</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assessment.triggeredRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{rule.title}</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">{rule.rationale}</div>
                    </td>
                    <td className="py-2.5 px-3 capitalize text-slate-600 whitespace-nowrap">
                      {rule.category}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {rule.observedValue}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {rule.thresholdReference}
                    </td>
                    <td className={`py-2.5 px-3 uppercase whitespace-nowrap ${SEVERITY_TEXT[rule.severity]}`}>
                      {rule.severity}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 whitespace-nowrap">
                      +{rule.scoreContribution}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recommended Immediate Actions */}
      <div className="space-y-2 pt-2">
        <h4 className="text-xs font-semibold text-slate-900">
          Recommended Action Protocol (Deterministic Baseline)
        </h4>
        <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700">
          {explanation.recommendedActions.map((action, idx) => (
            <li key={idx} className="leading-relaxed">
              {action}
            </li>
          ))}
        </ol>
      </div>

      {/* Non-Medical & Architecture Footer */}
      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
        <p>{explanation.disclaimer}</p>
        <span className="font-mono whitespace-nowrap shrink-0 text-slate-600">
          Provider: {explanation.engineMode}
        </span>
      </div>
    </section>
  );
};
