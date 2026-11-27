import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminComponent } from './admin.component';

describe('Etapas dos casos na administração técnica', () => {
  const url = '/api/v1/admin/case-stages';
  const initial = {
    version: 0,
    stages: [
      { code: 'RECEIVED', label: 'Recebido' },
      { code: 'SCREENING', label: 'Triagem' },
      { code: 'CLOSED', label: 'Encerrado' },
      { code: 'ARCHIVED', label: 'Arquivado' }
    ]
  };
  let fixture: ComponentFixture<AdminComponent>;
  let http: HttpTestingController;
  let root: HTMLElement;

  function button(name: string) {
    const control = Array.from(root.querySelectorAll('button'))
      .find(element => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name);
    if (!control) throw new Error('Botão ausente: ' + name);
    return control;
  }

  function click(name: string) {
    button(name).click();
    fixture.detectChanges();
  }

  function inputs() {
    return Array.from(root.querySelectorAll<HTMLInputElement>('app-admin-case-stages li input'));
  }

  function setName(index: number, label: string) {
    const input = inputs()[index];
    input.value = label;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function openEditor(configuration = initial) {
    click('Etapas dos casos');
    const request = http.expectOne(url);
    expect(request.request.method).toBe('GET');
    request.flush(configuration);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    fixture = TestBed.createComponent(AdminComponent);
    root = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/v1/admin/users/page').flush({ content: [], number: 0, size: 10, totalElements: 0, totalPages: 0 });
    http.expectOne('/api/v1/admin/campuses').flush([]);
    http.expectNone(url);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('busca em todas as páginas e salva a configuração completa após editar uma etapa filtrada', () => {
    const stages = [
      ...Array.from({ length: 11 }, (_, index) => ({ code: `ETAPA_${index + 1}`, label: `Etapa ${index + 1}` })),
      ...initial.stages.slice(-2),
    ];
    openEditor({ version: 3, stages });
    expect(inputs()).toHaveSize(10);
    click('Página 2');
    expect(inputs().map(input => input.value)).toEqual(['Etapa 11', 'Encerrado', 'Arquivado']);

    const filter = root.querySelector<HTMLInputElement>('app-admin-case-stages input[type="search"]')!;
    filter.value = 'etapa 11';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(inputs()).toHaveSize(1);
    setName(0, 'Análise revisada');
    expect(inputs()[0].value).toBe('Análise revisada');

    click('Salvar etapas');
    const request = http.expectOne(url);
    const expected = [...stages];
    expected[10] = { code: 'ETAPA_11', label: 'Análise revisada' };
    expect(request.request.body).toEqual({ version: 3, stages: expected });
    request.flush({ version: 4, stages: expected });
  });

  it('envia a ordem completa com versão zero, códigos estáveis e código nulo para a nova etapa', () => {
    openEditor();
    expect(inputs().map(input => input.value)).toEqual(['Recebido', 'Triagem', 'Encerrado', 'Arquivado']);
    expect(button('Descer etapa 2').disabled).toBeTrue();
    setName(1, 'Triagem pedagógica');
    click('Subir etapa 2');
    click('Adicionar etapa');
    setName(2, '  Acompanhamento externo  ');
    setName(3, 'Conclusão');
    expect(button('Descer etapa 3').disabled).toBeTrue();

    click('Salvar etapas');
    const request = http.expectOne(url);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      version: 0,
      stages: [
        { code: 'SCREENING', label: 'Triagem pedagógica' },
        { code: 'RECEIVED', label: 'Recebido' },
        { code: null, label: 'Acompanhamento externo' },
        { code: 'CLOSED', label: 'Conclusão' },
        { code: 'ARCHIVED', label: 'Arquivado' }
      ]
    });
    expect(inputs()[0].matches(':disabled')).toBeTrue();
    request.flush({
      version: 1,
      stages: [
        { code: 'SCREENING', label: 'Triagem pedagógica' },
        { code: 'RECEIVED', label: 'Recebido' },
        { code: 'CUSTOM_1', label: 'Acompanhamento externo' },
        { code: 'CLOSED', label: 'Conclusão' },
        { code: 'ARCHIVED', label: 'Arquivado' }
      ]
    });
    fixture.detectChanges();
    expect(inputs()[2].value).toBe('Acompanhamento externo');
    setName(2, 'Acompanhamento em rede');
    click('Salvar etapas');
    const next = http.expectOne(url);
    expect(next.request.body.version).toBe(1);
    expect(next.request.body.stages[2]).toEqual({ code: 'CUSTOM_1', label: 'Acompanhamento em rede' });
    next.flush({ version: 2, stages: next.request.body.stages });
  });

  it('impede nomes vazios e longos e permite remover apenas uma linha ainda sem código', () => {
    openEditor();
    setName(0, '   ');
    expect(button('Salvar etapas').disabled).toBeTrue();
    setName(0, 'x'.repeat(101));
    expect(button('Salvar etapas').disabled).toBeTrue();
    http.expectNone(url);
    setName(0, 'x'.repeat(100));
    expect(button('Salvar etapas').disabled).toBeFalse();

    click('Adicionar etapa');
    expect(button('Salvar etapas').disabled).toBeTrue();
    click('Remover etapa 3 do rascunho');
    expect(inputs()).toHaveSize(4);
    expect(button('Salvar etapas').disabled).toBeFalse();
  });

  it('preserva o rascunho após conflito até a recarga explícita da configuração', () => {
    openEditor();
    setName(1, 'Triagem do rascunho');
    click('Subir etapa 2');
    click('Adicionar etapa');
    setName(2, 'Rascunho de nova etapa');
    click('Salvar etapas');
    http.expectOne(url).flush(null, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(root.querySelector('app-admin-case-stages [role="alert"]')).not.toBeNull();
    expect(inputs().map(input => input.value)).toEqual([
      'Triagem do rascunho', 'Recebido', 'Rascunho de nova etapa', 'Encerrado', 'Arquivado'
    ]);
    expect(button('Salvar etapas').disabled).toBeTrue();
    click('Campi');
    expect(root.querySelector('app-admin-case-stages')?.hasAttribute('hidden')).toBeTrue();
    click('Etapas dos casos');
    expect(inputs()[2].value).toBe('Rascunho de nova etapa');
    http.expectNone(url);

    click('Recarregar e descartar rascunho');
    http.expectOne(url).flush(null, { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();
    expect(inputs()[2].value).toBe('Rascunho de nova etapa');
    expect(button('Salvar etapas').disabled).toBeTrue();

    click('Recarregar e descartar rascunho');
    const reload = http.expectOne(url);
    expect(reload.request.method).toBe('GET');
    reload.flush({
      version: 3,
      stages: [
        { code: 'RECEIVED', label: 'Recebido pela equipe' },
        { code: 'SCREENING', label: 'Triagem' },
        { code: 'CUSTOM_OTHER', label: 'Incluída por outra pessoa' },
        { code: 'CLOSED', label: 'Encerrado' },
        { code: 'ARCHIVED', label: 'Arquivado' }
      ]
    });
    fixture.detectChanges();
    http.expectNone(url);
    expect(inputs().map(input => input.value)).toEqual([
      'Recebido pela equipe', 'Triagem', 'Incluída por outra pessoa', 'Encerrado', 'Arquivado'
    ]);
    setName(1, 'Triagem revisada');
    click('Salvar etapas');
    const next = http.expectOne(url);
    expect(next.request.body).toEqual({
      version: 3,
      stages: [
        { code: 'RECEIVED', label: 'Recebido pela equipe' },
        { code: 'SCREENING', label: 'Triagem revisada' },
        { code: 'CUSTOM_OTHER', label: 'Incluída por outra pessoa' },
        { code: 'CLOSED', label: 'Encerrado' },
        { code: 'ARCHIVED', label: 'Arquivado' }
      ]
    });
    next.flush({ version: 4, stages: next.request.body.stages });
  });
});
