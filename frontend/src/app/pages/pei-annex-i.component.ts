import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, viewChildren } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Pei, PeiAnnexI } from '../core/models';
import {
  bibliographyColumns, bibliographyRow, contentRow, instrumentRow, maxSpecificObjectives, minSpecificObjectives, PeiAnnexIForm
} from './pei-annex-i-form';

type Bibliography = 'basicBibliography' | 'complementaryBibliography';
type RowGroup = 'contents' | 'assessmentInstruments' | Bibliography;

@Component({
  selector: 'app-pei-annex-i',
  imports: [NgTemplateOutlet, ReactiveFormsModule],
  templateUrl: './pei-annex-i.component.html',
  styleUrl: './pei-annex-i.component.css'
})
export class PeiAnnexIComponent {
  private readonly fb = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly specificObjectiveInputs = viewChildren<ElementRef<HTMLTextAreaElement>>('specificObjective');

  readonly form = input.required<PeiAnnexIForm>();
  readonly model = input.required<PeiAnnexI>();
  readonly pei = input.required<Pei>();
  readonly editable = input.required<boolean>();
  readonly saving = input.required<boolean>();

  protected readonly adjustedObjectives = ['eliminatedObjectives', 'alternativeObjectives', 'complementaryObjectives'];
  protected readonly minSpecificObjectives = minSpecificObjectives;
  protected readonly maxSpecificObjectives = maxSpecificObjectives;
  protected readonly curricula = ['professionalSkills', 'syllabus', 'prerequisites'];
  protected readonly methods = ['teachingStrategies', 'methodologicalResources'];
  protected readonly bibliographies: Bibliography[] = ['basicBibliography', 'complementaryBibliography'];
  protected readonly bibliographyColumns = bibliographyColumns;
  protected readonly identification = computed(() => {
    const pei = this.pei();
    return [
      { key: 'course', value: pei.content['course'] },
      { key: 'subject', value: pei.content['subject'] },
      { key: 'teacherName', value: pei.content['teacherName'] },
      { key: 'student', value: pei.content['student'] },
      { key: 'academicTerm', value: pei.academicTermLabel ?? pei.academicTerm },
      { key: 'workloadHours', value: pei.content['workloadHours'] }
    ];
  });

  protected addSpecificObjective() {
    const objectives = this.form().controls.specificObjectives;
    if (objectives.length >= maxSpecificObjectives) return;
    objectives.push(this.fb.nonNullable.control(''));
    objectives.markAsDirty();
    this.focusSpecificObjective(objectives.length - 1);
  }

  protected removeSpecificObjective(index: number) {
    const objectives = this.form().controls.specificObjectives;
    if (objectives.length <= minSpecificObjectives) return;
    objectives.removeAt(index);
    objectives.markAsDirty();
    this.focusSpecificObjective(Math.min(index, objectives.length - 1));
  }

  private focusSpecificObjective(index: number) {
    afterNextRender(() => this.specificObjectiveInputs()[index]?.nativeElement.focus(), { injector: this.injector });
  }

  protected addContent() {
    const rows = this.form().controls.contents;
    rows.push(contentRow(this.fb));
    rows.markAsDirty();
  }

  protected addInstrument() {
    const rows = this.form().controls.assessmentInstruments;
    rows.push(instrumentRow(this.fb));
    rows.markAsDirty();
  }

  protected addBibliography(key: Bibliography) {
    const rows = this.form().controls[key];
    rows.push(bibliographyRow(this.fb));
    rows.markAsDirty();
  }

  protected removeRow(key: RowGroup, index: number) {
    const rows = this.form().controls[key];
    rows.removeAt(index);
    rows.markAsDirty();
  }
}
