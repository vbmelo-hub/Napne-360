import { FormBuilder, FormControl } from '@angular/forms';
import { PeiAnnexI, PeiSkillRating } from '../core/models';

export const bibliographyColumns = [
  { key: 'title', label: 'bibliographyTitle' }, { key: 'author', label: 'bibliographyAuthor' },
  { key: 'edition', label: 'bibliographyEdition' }, { key: 'location', label: 'bibliographyLocation' },
  { key: 'publisher', label: 'bibliographyPublisher' }, { key: 'year', label: 'bibliographyYear' },
  { key: 'lt', label: 'bibliographyLt' }
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string').join('\n');
  return typeof value === 'string' ? value : '';
}

function rows(value: unknown, minimum: number): Record<string, unknown>[] {
  const current = Array.isArray(value) ? value.map(asRecord) : [];
  return current.concat(Array.from({ length: Math.max(0, minimum - current.length) }, () => ({})));
}

export function contentRow(fb: FormBuilder, value: Record<string, unknown> = {}) {
  const hours = value['workloadHours'];
  return fb.nonNullable.group({
    description: asText(value['description']),
    workloadHours: fb.control<number | null>(typeof hours === 'number' ? hours : null),
    priority: value['priority'] === true
  });
}

export function instrumentRow(fb: FormBuilder, value: Record<string, unknown> = {}) {
  return fb.nonNullable.group({ description: asText(value['description']), justification: asText(value['justification']) });
}

export function bibliographyRow(fb: FormBuilder, value: Record<string, unknown> = {}) {
  return fb.nonNullable.group({
    title: asText(value['title']), author: asText(value['author']), edition: asText(value['edition']),
    location: asText(value['location']), publisher: asText(value['publisher']), year: asText(value['year']), lt: asText(value['lt'])
  });
}

export function buildPeiAnnexIForm(fb: FormBuilder, model: PeiAnnexI, content: Record<string, unknown>) {
  const savedInventory = asRecord(content['skillsInventory']);
  const inventory = fb.record<FormControl<PeiSkillRating>>({});
  for (const group of model.inventoryGroups) {
    for (const indicator of group.indicators) {
      if (!indicator.hasOptions) continue;
      const answer = model.ratings.find(rating => rating.value === savedInventory[indicator.id]);
      inventory.addControl(indicator.id, fb.nonNullable.control(answer?.value ?? 'NAO_OBSERVADO'));
    }
  }

  return fb.nonNullable.group({
    generalObjectives: asText(content['generalObjectives']), specificObjectives: asText(content['specificObjectives']),
    eliminatedObjectives: asText(content['eliminatedObjectives']), alternativeObjectives: asText(content['alternativeObjectives']),
    complementaryObjectives: asText(content['complementaryObjectives']), professionalSkills: asText(content['professionalSkills']),
    syllabus: asText(content['syllabus']), prerequisites: asText(content['prerequisites']),
    contents: fb.array(rows(content['contents'], 1).map(row => contentRow(fb, row))),
    teachingStrategies: asText(content['teachingStrategies']), methodologicalResources: asText(content['methodologicalResources']),
    assessmentCriteria: asText(content['assessmentCriteria']),
    assessmentInstruments: fb.array(rows(content['assessmentInstruments'], 1).map(row => instrumentRow(fb, row))),
    recoveryProposal: asText(content['recoveryProposal']),
    basicBibliography: fb.array(rows(content['basicBibliography'], 3).map(row => bibliographyRow(fb, row))),
    complementaryBibliography: fb.array(rows(content['complementaryBibliography'], 3).map(row => bibliographyRow(fb, row))),
    skillsInventory: inventory,
    observations: asText(content['observations']), location: asText(content['location']), documentDate: asText(content['documentDate'])
  });
}

export type PeiAnnexIForm = ReturnType<typeof buildPeiAnnexIForm>;

export function peiAnnexIContent(form: PeiAnnexIForm): Record<string, unknown> {
  const value = form.getRawValue();
  const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
  return {
    ...value,
    specificObjectives: lines(value.specificObjectives), eliminatedObjectives: lines(value.eliminatedObjectives),
    alternativeObjectives: lines(value.alternativeObjectives), complementaryObjectives: lines(value.complementaryObjectives),
    professionalSkills: lines(value.professionalSkills), teachingStrategies: lines(value.teachingStrategies),
    methodologicalResources: lines(value.methodologicalResources), assessmentCriteria: lines(value.assessmentCriteria),
    contents: value.contents.filter(row => row.description.trim() || row.workloadHours !== null || row.priority),
    assessmentInstruments: value.assessmentInstruments.filter(row => row.description.trim() || row.justification.trim()),
    basicBibliography: value.basicBibliography.filter(row => Object.values(row).some(text => text.trim())),
    complementaryBibliography: value.complementaryBibliography.filter(row => Object.values(row).some(text => text.trim()))
  };
}
