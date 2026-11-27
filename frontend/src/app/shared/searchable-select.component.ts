import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, forwardRef,
  inject, input, signal, untracked, viewChild
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Observable, catchError, map, of, startWith, switchMap, timer } from 'rxjs';

export interface SearchableOption {
  id: string;
  label: string;
  detail?: string;
}

export interface SearchablePage<T extends SearchableOption> {
  content: readonly T[];
  totalElements: number;
  selected: T | null;
}

export type SearchableLookup<T extends SearchableOption = SearchableOption> =
  (query: string, selectedId: string, page: number) => Observable<SearchablePage<T>>;

interface LookupRequest<T extends SearchableOption> {
  query: string;
  result: Observable<SearchablePage<T>>;
}

type LookupState<T extends SearchableOption> =
  | { request: LookupRequest<T>; status: 'loading' | 'error' }
  | { request: LookupRequest<T>; status: 'ready'; page: SearchablePage<T> };

const REMOTE_PAGE_SIZE = 30;

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
let nextId = 0;

@Component({
  selector: 'app-searchable-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SearchableSelectComponent), multi: true }],
  host: {
    '(focusout)': 'onFocusOut($event)',
    '(document:pointerdown)': 'onOutsidePointer($event)',
  },
  template: `
    <label [id]="labelId" [for]="open() ? searchId : triggerId">
      <span>{{label()}} @if (required()) {<span class="field-required" aria-hidden="true">*</span>}</span>
    </label>
    @if (required()) {<span [id]="requiredId" class="sr-only">Campo obrigatório</span>}
    <div class="selection">
      <button #trigger [id]="triggerId" type="button" class="secondary trigger" [disabled]="disabled()"
        [attr.aria-disabled]="readonly() ? 'true' : null" [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? listId : null" [attr.aria-labelledby]="labelId + ' ' + valueId"
        [attr.aria-describedby]="required() ? requiredId : null"
        (click)="open() ? close(true) : show()" (keydown)="openWithKeyboard($event)">
        <span [id]="valueId">{{selected()?.label ?? selectionPlaceholder()}} @if (selected()?.detail; as detail) {<small>{{detail}}</small>}</span>
        @if (!readonly()) {<span aria-hidden="true">▾</span>}
      </button>
      @if (selected() && !required() && !readonly()) {
        <button type="button" class="secondary" [disabled]="disabled()" [attr.aria-label]="'Limpar ' + label()"
          (click)="choose('')">×</button>
      }
    </div>
    @if (open()) {
      <div class="options-panel">
        <input #search [id]="searchId" type="search" role="combobox" autocomplete="off" aria-autocomplete="list"
          [attr.aria-labelledby]="labelId" [attr.aria-controls]="listId" aria-expanded="true"
          [attr.aria-required]="required() ? 'true' : null" [attr.aria-activedescendant]="activeOptionId()"
          [placeholder]="placeholder()" [value]="query()" (input)="searchFor(search.value)" (keydown)="onSearchKey($event)">
        <div role="listbox" [id]="listId" [attr.aria-labelledby]="labelId" [attr.aria-busy]="loading() || lookupPending()">
          @for (option of results(); track option.id; let index = $index) {
            <div role="option" [id]="optionId(index)" tabindex="-1" [attr.aria-selected]="option.id === value()"
              [class.highlighted]="activeIndex() === index" (pointerdown)="$event.preventDefault()" (click)="choose(option.id)" (keydown.enter)="choose(option.id)">
              <span>{{option.label}} @if (option.detail) {<small>{{option.detail}}</small>}</span>
              @if (option.id === value()) {<span aria-hidden="true">✓</span>}
            </div>
          }
        </div>
        <p role="status">
          @if (loading() || lookupPending()) {Buscando opções…}
          @else if (error()) { {{error()}} }
          @else if (lookupFailed()) {Não foi possível concluir a consulta.}
          @else if (!results().length) { {{query().trim() ? 'Nenhum resultado encontrado.' : emptyMessage()}} }
          @else if (totalPages() > 1) {Exibindo {{pageStart() + 1}}–{{pageStart() + results().length}} de {{totalResults()}} opções.}
          @else { {{results().length}} opção(ões) disponível(is). }
        </p>
        @if (remotePage() && (pageIndex() > 0 || totalPages() > 1)) {
          <nav class="option-pages" [attr.aria-label]="'Páginas de ' + label()">
            <button type="button" class="secondary compact" [disabled]="pageIndex() === 0"
              (click)="changePage(-1)" (keydown.escape)="closeOnEscape($event)">Anterior</button>
            <button type="button" class="secondary compact" [disabled]="pageIndex() + 1 >= totalPages()"
              (click)="changePage(1)" (keydown.escape)="closeOnEscape($event)">Próxima</button>
          </nav>
        }
      </div>
    } @else if (loading() || lookupPending()) {
      <p role="status">Carregando opções…</p>
    } @else if (error() || lookupFailed()) {
      <p role="status">{{error() || 'Não foi possível concluir a consulta.'}}</p>
    } @else if (showEmptyStatus()) {
      <p role="status">{{emptyMessage()}}</p>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    label { margin-bottom: .35rem; }
    .selection, [role="option"] { display: flex; gap: .5rem; }
    .trigger, [role="option"] { justify-content: space-between; align-items: center; text-align: left; }
    .trigger { display: flex; flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .options-panel { margin-top: .35rem; border: 1px solid var(--border); border-radius: .5rem; padding: .5rem; }
    [role="listbox"] { max-height: min(14rem, 35vh); overflow: auto; }
    [role="option"] { padding: .5rem; cursor: pointer; overflow-wrap: anywhere; }
    [role="option"].highlighted { background: var(--surface-muted, #e9f0f5); outline: 1px solid currentColor; outline-offset: -1px; }
    small { display: block; font-weight: normal; }
    .option-pages { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .35rem; }
    p { margin: .35rem 0 0; font-size: .875rem; }
  `,
})
export class SearchableSelectComponent<T extends SearchableOption = SearchableOption> implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly options = input<readonly T[]>([]);
  readonly required = input(false);
  readonly readonly = input(false);
  readonly loading = input(false);
  readonly error = input('');
  readonly placeholder = input('Pesquisar…');
  readonly emptyMessage = input('Nenhuma opção disponível.');
  readonly selectionPlaceholder = input('Selecione');
  // null disables the remote source until its dependencies are available.
  readonly remote = input<SearchableLookup<T> | null>();

  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly id = `searchable-select-${++nextId}`;
  readonly requiredId = `${this.id}-required`;
  readonly valueId = `${this.id}-value`;
  readonly triggerId = `${this.id}-trigger`;
  readonly labelId = `${this.id}-label`;
  readonly listId = `${this.id}-options`;
  readonly searchId = `${this.id}-query`;

  readonly value = signal('');
  readonly disabled = signal(false);
  readonly open = signal(false);
  readonly query = signal('');
  readonly activeIndex = signal(-1);
  private readonly lastSelection = signal<T | null>(null);
  private readonly page = signal<{ lookup: SearchableLookup<T>; index: number } | null>(null);
  private readonly refreshVersion = signal(0);
  protected readonly pageIndex = computed(() => {
    const page = this.page();
    return page && page.lookup === this.remote() ? page.index : 0;
  });
  protected readonly pageStart = computed(() => this.pageIndex() * REMOTE_PAGE_SIZE);
  private readonly request = computed<LookupRequest<T> | null>(() => {
    const lookup = this.remote();
    const id = this.value();
    if (!lookup || (!this.required() && !id && !this.open())) return null;
    const query = this.query().trim();
    this.refreshVersion();
    return { query, result: lookup(query, id, this.pageIndex()) };
  });
  private readonly lookupState = toSignal(toObservable(this.request).pipe(
    switchMap(request => {
      if (!request) return of(null);
      return (request.query ? timer(250) : of(0)).pipe(
        switchMap(() => request.result),
        map((page): LookupState<T> => ({ request, status: 'ready', page })),
        catchError(() => of<LookupState<T>>({ request, status: 'error' })),
        startWith<LookupState<T>>({ request, status: 'loading' }),
      );
    }),
  ));
  private readonly currentLookup = computed(() => {
    const state = this.lookupState();
    return state?.request === this.request() ? state : null;
  });
  protected readonly remotePage = computed(() => {
    const state = this.currentLookup();
    return state?.status === 'ready' ? state.page : null;
  });
  readonly lookupPending = computed(() => !!this.request() && (!this.currentLookup() || this.currentLookup()?.status === 'loading'));
  readonly lookupFailed = computed(() => this.currentLookup()?.status === 'error');
  readonly selected = computed(() => {
    const value = this.value();
    if (this.remote() === undefined) return this.options().find(option => option.id === value);
    const page = this.remotePage();
    if (page) return page.selected?.id === value ? page.selected : null;
    const previous = this.lastSelection();
    return this.remote() && previous?.id === value ? previous : null;
  });
  readonly validatedOption = computed(() => {
    const option = this.remotePage()?.selected;
    return option && option.id === this.value() ? option : null;
  });
  readonly selectionValidated = computed(() => this.validatedOption() !== null);
  readonly results = computed(() => {
    if (this.loading() || this.error()) return [];
    if (this.remote() !== undefined) return this.remotePage()?.content ?? [];
    const terms = normalize(this.query().trim()).split(/\s+/).filter(Boolean);
    return this.options().filter(option => {
      const fields = normalize(`${option.label} ${option.detail ?? ''}`);
      return terms.every(term => fields.includes(term));
    });
  });
  readonly totalResults = computed(() => this.remotePage()?.totalElements ?? this.results().length);
  protected readonly totalPages = computed(() => Math.ceil((this.remotePage()?.totalElements ?? 0) / REMOTE_PAGE_SIZE));
  readonly showEmptyStatus = computed(() => this.remote() === undefined ? !this.options().length
    : this.remote() === null || this.remotePage()?.totalElements === 0);
  readonly activeOptionId = computed(() => this.results()[this.activeIndex()] ? this.optionId(this.activeIndex()) : null);

  private changed?: (value: string) => void;
  private touched?: () => void;

  constructor() {
    effect(() => {
      const selected = this.remotePage()?.selected;
      if (selected) this.lastSelection.set(selected);
    });
    effect(() => {
      if (this.disabled() || this.readonly()) {
        untracked(() => this.close());
        return;
      }
      if (this.reconcileValue() === this.value()) return;
      // CVA callbacks update the parent form, which has already been checked in this render.
      queueMicrotask(() => {
        if (this.destroyRef.destroyed) return;
        this.updateValue(this.reconcileValue());
        this.changeDetector.markForCheck();
      });
    });
  }

  writeValue(value: string | null): void { this.value.set(value ?? ''); }
  registerOnChange(callback: (value: string) => void): void { this.changed = callback; }
  registerOnTouched(callback: () => void): void { this.touched = callback; }
  setDisabledState(disabled: boolean): void { this.disabled.set(disabled); }

  optionId(index: number): string { return `${this.id}-option-${index}`; }

  show(): void {
    if (this.disabled() || this.readonly()) return;
    this.open.set(true);
    if (this.lookupFailed()) this.refresh();
    afterNextRender(() => this.search()?.nativeElement.focus(), { injector: this.injector });
  }

  close(restoreFocus = false): void {
    if (!this.open()) return;
    if (restoreFocus) this.trigger()?.nativeElement.focus();
    this.open.set(false);
    this.searchFor('');
  }

  refresh(): void {
    this.refreshVersion.update(version => version + 1);
  }

  protected changePage(step: number): void {
    const lookup = this.remote();
    const index = this.pageIndex() + step;
    if (!lookup || !this.remotePage() || index < 0 || (step > 0 && index >= this.totalPages())) return;
    this.search()?.nativeElement.focus();
    this.page.set({ lookup, index });
    this.activeIndex.set(-1);
  }

  searchFor(query: string): void {
    this.page.set(null);
    this.query.set(query);
    this.activeIndex.set(-1);
  }

  choose(id: string): void {
    if (this.disabled() || this.readonly()) return;
    this.updateValue(id);
    this.touched?.();
    if (this.open()) this.close(true);
    else this.trigger()?.nativeElement.focus();
  }

  onFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && this.element.nativeElement.contains(event.relatedTarget)) return;
    this.touched?.();
    this.close();
  }

  onOutsidePointer(event: PointerEvent): void {
    if (this.open() && event.target instanceof Node && !this.element.nativeElement.contains(event.target)) this.close();
  }

  openWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    this.show();
    if (this.open()) this.activeIndex.set(0);
  }

  protected closeOnEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeOnEscape(event);
      return;
    }
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const options = this.results();
    if (event.key === 'Enter') {
      const option = options[this.activeIndex()];
      if (option) this.choose(option.id);
      return;
    }
    if (!options.length) return;
    const current = this.activeIndex();
    const next = event.key === 'ArrowDown' ? Math.min(current + 1, options.length - 1) : (current < 0 ? options.length - 1 : Math.max(current - 1, 0));
    this.activeIndex.set(next);
    this.element.nativeElement.querySelector(`#${this.optionId(next)}`)?.scrollIntoView({ block: 'nearest' });
  }

  private reconcileValue(): string {
    const value = this.value();
    if (this.disabled() || this.readonly() || this.loading() || this.error()) return value;
    if (this.remote() !== undefined) {
      if (this.remote() === null) return '';
      const page = this.remotePage();
      if (!page) return value;
      if (value && page.selected?.id === value) return value;
      return this.required() && !this.query().trim() && this.pageIndex() === 0 && page.totalElements === 1
        ? page.content[0]?.id ?? '' : '';
    }
    const options = this.options();
    if (value && options.some(option => option.id === value)) return value;
    return this.required() && options.length === 1 ? options[0].id : '';
  }

  private updateValue(value: string): void {
    if (value === this.value()) return;
    if (this.remote() !== undefined) {
      this.lastSelection.set(this.remotePage()?.content.find(option => option.id === value) ?? null);
    }
    this.value.set(value);
    this.changed?.(value);
  }
}
