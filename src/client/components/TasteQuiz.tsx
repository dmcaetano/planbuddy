import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { Constraint, Taste } from "../api/types";
import { QUIZ_QUESTIONS } from "@shared/quiz";
import { Check, HelpCircle, X } from "lucide-react";
import "../styles/quiz.css";

export interface TasteQuizResult {
  tastes: Taste[];
  constraints: Constraint[];
}

export interface TasteQuizProps {
  /** Tapped "Skip" (top bar) — exit the whole quiz without writing anything. */
  onSkip: () => void;
  /** Label + handler for the completion screen's primary button. */
  primaryActionLabel: string;
  onPrimaryAction: (result: TasteQuizResult) => void;
  /** Label + handler for the completion screen's secondary button. */
  secondaryActionLabel: string;
  onSecondaryAction: (result: TasteQuizResult) => void;
  /** Shown above the first question — lets callers explain a retake wipes prior answers. */
  intro?: string;
}

const TOTAL = QUIZ_QUESTIONS.length;

export default function TasteQuiz({
  onSkip,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  intro,
}: TasteQuizProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TasteQuizResult | null>(null);

  const question = QUIZ_QUESTIONS[stepIndex];
  const selected = answers[question?.id ?? ""] ?? [];
  const isLast = stepIndex === TOTAL - 1;

  function toggleOption(optionId: string) {
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      if (question.multi) {
        if (current.includes(optionId)) {
          return { ...prev, [question.id]: current.filter((id) => id !== optionId) };
        }
        if (question.maxSelect && current.length >= question.maxSelect) {
          return prev;
        }
        return { ...prev, [question.id]: [...current, optionId] };
      }
      return { ...prev, [question.id]: current.includes(optionId) ? [] : [optionId] };
    });
  }

  function notSure() {
    setAnswers((prev) => ({ ...prev, [question.id]: [] }));
    advance();
  }

  function advance() {
    if (isLast) {
      void submit();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        answers: QUIZ_QUESTIONS.map((q) => ({ questionId: q.id, optionIds: answers[q.id] ?? [] })).filter(
          (a) => a.optionIds.length > 0
        ),
      };
      const data = await api.post<TasteQuizResult>("/tastes/quiz", payload);
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your fun profile. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="quiz-card quiz-done">
        <div className="eyebrow">Fun profile</div>
        <h1>Profile saved</h1>
        <p>
          <strong>{result.tastes.length}</strong> {result.tastes.length === 1 ? "taste" : "tastes"} and{" "}
          <strong>{result.constraints.length}</strong> {result.constraints.length === 1 ? "protection" : "protections"} added. See
          them in Memory.
        </p>
        <div className="row-gap quiz-done-actions">
          <button type="button" className="btn btn-primary" onClick={() => onPrimaryAction(result)}>
            {primaryActionLabel}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onSecondaryAction(result)}>
            {secondaryActionLabel}
          </button>
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="quiz-card">
      <div className="quiz-topbar">
        <div className="quiz-progress" aria-live="polite">
          {stepIndex + 1} of {TOTAL}
        </div>
        <button type="button" className="btn btn-ghost btn-sm quiz-skip" onClick={onSkip}>
          <X size={14} /> Skip
        </button>
      </div>

      {intro && stepIndex === 0 && <p className="muted quiz-intro">{intro}</p>}

      {error && <div className="error-banner">{error}</div>}

      <h1 className="quiz-prompt">{question.prompt}</h1>
      {question.multi && (
        <p className="muted quiz-hint">
          {question.maxSelect ? `Pick up to ${question.maxSelect}` : "Select all that apply"}
        </p>
      )}

      <div className="quiz-chip-grid" role="group" aria-label={question.prompt}>
        {question.options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`quiz-chip${isSelected ? " quiz-chip--selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => toggleOption(option.id)}
            >
              {isSelected && <Check size={16} className="quiz-chip-check" />}
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="quiz-footer">
        {stepIndex > 0 && (
          <button type="button" className="btn btn-ghost" onClick={back} disabled={submitting}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-ghost quiz-not-sure" onClick={notSure} disabled={submitting}>
          <HelpCircle size={16} /> Not sure
        </button>
        <button type="button" className="btn btn-primary quiz-next" onClick={advance} disabled={submitting}>
          {submitting ? "Saving…" : isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
