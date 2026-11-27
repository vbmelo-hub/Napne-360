import { FormControl } from '@angular/forms';

export function reconcileRequiredSelection(control: FormControl<string>, eligibleValues: readonly string[]): void {
  if (eligibleValues.includes(control.value)) return;
  const next = eligibleValues.length === 1 ? eligibleValues[0] : '';
  if (next !== control.value) control.setValue(next);
}
