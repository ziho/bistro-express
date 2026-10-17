import { Check } from 'lucide-react';
import { EDITOR_STEPS, STEP_TITLE, type EditorStep } from '../../lib/editorFlow';

interface Props {
  step: EditorStep;
  onSelect: (step: EditorStep) => void;
  disabled?: boolean;
}

/** Compact, clickable progress: going back is free, going forward runs the same checks as 下一步. */
export function EditorStepper({ step, onSelect, disabled }: Props) {
  return (
    <nav className="editor-stepper" aria-label="安排进度">
      <ol>
        {EDITOR_STEPS.map((s) => {
          const state = s === step ? 'is-current' : s < step ? 'is-done' : '';
          return (
            <li key={s} className={state}>
              <button
                type="button"
                className="editor-stepper-btn"
                aria-current={s === step ? 'step' : undefined}
                onClick={() => onSelect(s)}
                disabled={disabled}
              >
                <span className="editor-stepper-num" aria-hidden="true">
                  {s < step ? <Check /> : s}
                </span>
                <span className="editor-stepper-label">
                  <span className="sr-only">第 {s} 步：</span>
                  {STEP_TITLE[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
